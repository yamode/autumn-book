// 取引先予約の設定（rms_partners.booking_settings）と、受付期限・取消期限の判定（サーバ・画面共通の純関数）。
//
// 予約そのものは autumn-shared の public.rms_partner_create_booking（DB 関数）が1トランザクションで作り、
// 直販予約と同じ電文で PMS へ届ける（migration 20260926054852）。ここは「受け付けてよいか」の判断と、
// RMS の設定画面・取引先の予約画面で使う形の定義だけを持つ。

export type PartnerBookingOptionType = 'check' | 'select' | 'text';

// 予約時に取引先へ聞く追加項目（送迎希望・記念日・夕食時間など）。回答は PMS の予約備考に入る。
export type PartnerBookingOption = {
  id: string;
  label: string;
  type: PartnerBookingOptionType;
  choices: string[]; // type=select のときの選択肢
  required: boolean;
};

// 支払方法（取引先ごとの契約で許可するもの。複数可。予約時に取引先が選ぶ）。
//   invoice_monthly … 後払い（銀行振込）
//   online          … 予約時にカード決済（Stripe Checkout）。割引（prepayDiscount）を付けられる
//   online_checkin  … 予約時にカードを登録し、チェックイン日に自動で請求（Stripe・off-session）
export type PartnerPaymentOptionId = 'invoice_monthly' | 'online' | 'online_checkin';
export const PARTNER_PAYMENT_OPTIONS: { id: PartnerPaymentOptionId; label: string; note: string }[] = [
  { id: 'invoice_monthly', label: '月末締め翌月末銀行振込', note: 'ご利用月の月末締めで請求し、翌月末までに銀行振込' },
  { id: 'online', label: 'オンライン決済（予約時）', note: '予約時にクレジットカードでお支払い（Stripe）' },
  { id: 'online_checkin', label: 'オンライン決済（チェックイン日）', note: '予約時にクレジットカードを登録し、チェックイン日に自動でお支払い（Stripe）' }
];
export const paymentOptionLabel = (id: string) => PARTNER_PAYMENT_OPTIONS.find((o) => o.id === id)?.label ?? id;
// Stripe を使う支払方法
export const isStripePaymentOption = (id: string) => id === 'online' || id === 'online_checkin';

// 予約時決済の割引（取引先ごと）。泊ごとの1名単価に当てるので、PMS の請求額とも一致する。
//   percent … 単価の N% 引き（1円未満四捨五入）
//   yen     … 1名1泊あたり N 円引き
export type PrepayDiscount = { type: 'none' | 'percent' | 'yen'; value: number };
export const NO_PREPAY_DISCOUNT: PrepayDiscount = { type: 'none', value: 0 };

export function normalizePrepayDiscount(raw: unknown): PrepayDiscount {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const type = src.type === 'percent' || src.type === 'yen' ? src.type : 'none';
  if (type === 'none') return { ...NO_PREPAY_DISCOUNT };
  const n = Math.round(Number(src.value));
  if (!Number.isFinite(n) || n <= 0) return { ...NO_PREPAY_DISCOUNT };
  return { type, value: type === 'percent' ? Math.min(50, n) : Math.min(100000, n) };
}

export const hasPrepayDiscount = (d: PrepayDiscount) => d.type !== 'none' && d.value > 0;

// 割引後の1名1泊単価（1円未満にはしない）。
export function applyPrepayDiscount(unit: number, d: PrepayDiscount): number {
  if (!hasPrepayDiscount(d)) return unit;
  const v = d.type === 'percent' ? Math.round((unit * (100 - d.value)) / 100) : unit - d.value;
  return Math.max(1, v);
}

// 画面・メール・PMS 備考用の説明（例: 「5%引き」「1名1泊 1,000円引き」）。
export function describePrepayDiscount(d: PrepayDiscount): string {
  if (!hasPrepayDiscount(d)) return '';
  return d.type === 'percent' ? `${d.value}%引き` : `1名1泊 ${d.value.toLocaleString('ja-JP')}円引き`;
}

export type PartnerBookingSettings = {
  // 許可する支払方法（1つ以上）。
  paymentOptions: PartnerPaymentOptionId[];
  // 予約時決済（online）を選んだときの割引。
  prepayDiscount: PrepayDiscount;
  // 受付締切: 宿泊日の leadDays 日前の cutoffHour 時（JST）まで。0日前 = 当日。
  leadDays: number;
  cutoffHour: number;
  // 1回の予約の上限。
  maxRooms: number;
  maxNights: number;
  // 取引先が画面から取り消せる期限: 宿泊日の cancelDays 日前の cutoffHour 時まで。null = 画面からは取り消せない。
  cancelDays: number | null;
  // 予約画面に出す案内（支払・キャンセル規定など。取引先向け）。
  notice: string;
  options: PartnerBookingOption[];
  // 予約・取消の通知メール（宿側の宛先）。
  notifyEmails: string[];
  // 取引先（予約した人のメール・取引先の連絡先メール）へも予約確認メールを送るか。
  notifyPartner: boolean;
};

export const DEFAULT_PARTNER_BOOKING_SETTINGS: PartnerBookingSettings = {
  paymentOptions: ['invoice_monthly'],
  prepayDiscount: { type: 'none', value: 0 },
  leadDays: 1,
  cutoffHour: 18,
  maxRooms: 5,
  maxNights: 7,
  cancelDays: 1,
  notice: '',
  options: [],
  notifyEmails: [],
  notifyPartner: true
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// DB の jsonb / 画面からの入力を、欠けや不正値を補って正規形にする（保存前・読込時の両方で通す）。
export function normalizePartnerBookingSettings(raw: unknown): PartnerBookingSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PARTNER_BOOKING_SETTINGS;
  const optionsRaw = Array.isArray(src.options) ? src.options : [];
  const options: PartnerBookingOption[] = optionsRaw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map((o, i) => {
      const type: PartnerBookingOptionType = o.type === 'select' || o.type === 'text' ? o.type : 'check';
      const choices = Array.isArray(o.choices)
        ? [...new Set(o.choices.map((c) => String(c ?? '').trim()).filter(Boolean))].slice(0, 20)
        : [];
      return {
        id: String(o.id ?? '').trim() || `opt-${i + 1}`,
        label: String(o.label ?? '').trim().slice(0, 60),
        type,
        choices: type === 'select' ? choices : [],
        required: o.required === true
      };
    })
    .filter((o) => o.label)
    .slice(0, 20);
  const emails = Array.isArray(src.notifyEmails)
    ? [...new Set(src.notifyEmails.map((e) => String(e ?? '').trim()).filter((e) => EMAIL_RE.test(e)))].slice(0, 10)
    : [];
  const cancelDays =
    src.cancelDays === null || src.cancelDays === '' ? null : src.cancelDays === undefined ? d.cancelDays : clampInt(src.cancelDays, 0, 90, 1);
  const payIds = PARTNER_PAYMENT_OPTIONS.map((o) => o.id);
  const paymentOptions = Array.isArray(src.paymentOptions)
    ? payIds.filter((id) => (src.paymentOptions as unknown[]).includes(id))
    : [...d.paymentOptions];
  return {
    paymentOptions,
    prepayDiscount: normalizePrepayDiscount(src.prepayDiscount),
    leadDays: clampInt(src.leadDays, 0, 90, d.leadDays),
    cutoffHour: clampInt(src.cutoffHour, 0, 23, d.cutoffHour),
    maxRooms: clampInt(src.maxRooms, 1, 20, d.maxRooms),
    maxNights: clampInt(src.maxNights, 1, 30, d.maxNights),
    cancelDays,
    notice: String(src.notice ?? '').trim().slice(0, 1000),
    options,
    notifyEmails: emails,
    notifyPartner: src.notifyPartner === undefined ? d.notifyPartner : src.notifyPartner === true
  };
}

// 保存時の検証（normalize で吸収できない入力ミス）。
export function validatePartnerBookingSettings(s: PartnerBookingSettings, bookingEnabled = false): string | null {
  if (bookingEnabled && !s.paymentOptions.length) return '予約を受け付けるときは、支払方法を1つ以上選んでください。';
  for (const [i, o] of s.options.entries()) {
    if (o.type === 'select' && o.choices.length < 2) return `予約オプション${i + 1}「${o.label}」: 選択肢を2つ以上入れてください。`;
  }
  return null;
}

// ---- 期限（JST） ----

const JST_OFFSET_MS = 9 * 3600 * 1000;
const addDays = (iso: string, days: number) =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

// 宿泊日 checkIn の「days 日前の hour 時（JST）」の瞬間。
export function deadlineOf(checkIn: string, days: number, hour: number): Date {
  const day = addDays(checkIn, -days);
  return new Date(Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`) - JST_OFFSET_MS);
}

export function bookingDeadline(checkIn: string, s: Pick<PartnerBookingSettings, 'leadDays' | 'cutoffHour'>): Date {
  return deadlineOf(checkIn, s.leadDays, s.cutoffHour);
}

export function canBookFor(checkIn: string, s: Pick<PartnerBookingSettings, 'leadDays' | 'cutoffHour'>, now = new Date()): boolean {
  return now.getTime() < bookingDeadline(checkIn, s).getTime();
}

export function cancelDeadline(checkIn: string, s: Pick<PartnerBookingSettings, 'cancelDays' | 'cutoffHour'>): Date | null {
  return s.cancelDays == null ? null : deadlineOf(checkIn, s.cancelDays, s.cutoffHour);
}

export function canPartnerCancel(checkIn: string, s: Pick<PartnerBookingSettings, 'cancelDays' | 'cutoffHour'>, now = new Date()): boolean {
  const dl = cancelDeadline(checkIn, s);
  return !!dl && now.getTime() < dl.getTime();
}

// 期限の説明（画面表示用）。
export function describeDeadline(days: number, hour: number): string {
  return `${days === 0 ? '当日' : `${days}日前`}の${hour}時まで`;
}

// ---- 予約入力（取引先の画面 → サーバ） ----

export type PartnerBookingGuestInput = {
  familyName: string;
  givenName: string;
  familyNameKana: string;
  givenNameKana: string;
  phone: string;
  email: string;
  zipCode: string;
  address: string;
  allergies: string;
};

// 追加オプションの回答を検証して {label, value} の並びにする。
export function resolveOptionAnswers(
  options: PartnerBookingOption[],
  answers: Record<string, string>
): { ok: true; values: { label: string; value: string }[] } | { ok: false; message: string } {
  const values: { label: string; value: string }[] = [];
  for (const o of options) {
    const raw = String(answers[o.id] ?? '').trim();
    if (o.type === 'check') {
      if (raw === '1' || raw === 'true' || raw === 'on') values.push({ label: o.label, value: 'あり' });
      else if (o.required) return { ok: false, message: `「${o.label}」を確認してください。` };
      continue;
    }
    if (!raw) {
      if (o.required) return { ok: false, message: `「${o.label}」を入力してください。` };
      continue;
    }
    if (o.type === 'select' && !o.choices.includes(raw)) return { ok: false, message: `「${o.label}」の選択肢が正しくありません。` };
    values.push({ label: o.label, value: raw.slice(0, 500) });
  }
  return { ok: true, values };
}
