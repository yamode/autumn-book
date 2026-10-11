// 取引先予約の設定（rms_partners.booking_settings）と、受付期限・取消期限の判定（サーバ・画面共通の純関数）。
//
// 予約そのものは autumn-shared の public.rms_partner_create_booking（DB 関数）が1トランザクションで作り、
// 直販予約と同じ電文で PMS へ届ける（migration 20260926054852）。ここは「受け付けてよいか」の判断と、
// RMS の設定画面・取引先の予約画面で使う形の定義だけを持つ。
import { displayPlanName } from '$lib/partner-contents';
import { normalizeCancelPolicyMode, normalizeCancelRules, type CancelPolicyMode, type MemberCancelRule } from '$lib/partner-member-page';
import { normalizeBookingQuestions, resolveQuestionAnswers, validateBookingQuestions, type BookingQuestion, type BookingQuestionType } from '$lib/booking-questions';

export type PartnerBookingOptionType = BookingQuestionType;

// 取引先ごとに、プランの項目（lib/booking-questions.ts）に足して聞く項目（送迎希望・記念日・夕食時間など）。回答は PMS の予約備考に入る。
export type PartnerBookingOption = BookingQuestion;

// 支払方法（取引先ごとの契約で許可するもの。複数可。予約時に取引先が選ぶ）。
//   invoice_monthly … 後払い（銀行振込）
//   online          … 予約時にカード決済（Stripe Checkout）。割引（prepayDiscount）を付けられる
//   online_checkin  … 予約時にカードを登録し、チェックアウト日に自動で請求（Stripe・off-session）。
//                      ID は互換のため online_checkin のまま（2026-10-07 にチェックイン日→チェックアウト日へ変更。現地精算と揃える）
export type PartnerPaymentOptionId = 'invoice_monthly' | 'online' | 'online_checkin';
export const PARTNER_PAYMENT_OPTIONS: { id: PartnerPaymentOptionId; label: string; note: string }[] = [
  { id: 'invoice_monthly', label: '月末締め翌月末銀行振込', note: 'ご利用月の月末締めで請求し、翌月末までに銀行振込' },
  { id: 'online', label: 'オンライン決済（予約時）', note: '予約時にクレジットカードでお支払い（Stripe）' },
  { id: 'online_checkin', label: 'オンライン決済（チェックアウト日）', note: '予約時にクレジットカードを登録し、チェックアウト日に自動でお支払い（Stripe）' }
];
export const isBuiltinPaymentOption = (id: string): id is PartnerPaymentOptionId => PARTNER_PAYMENT_OPTIONS.some((o) => o.id === id);

// デポジット（Phase 3b・docs/partner-pms-customer-link.md §5.3）: 受付枠（与信）を超えた予約で、一部を予約時にオンライン決済し、
// 残額は月末の請求書か現地で精算する。取引先の paymentOptions には出さない（人が選ぶ設定ではない）。
// 受付枠を超え、超過時の挙動が deposit のときだけ、サーバが見積の選択肢に差し込む（online と並べる）。
export const DEPOSIT_PAYMENT_OPTION = 'deposit_online';
export const DEPOSIT_PAYMENT_LABEL = 'デポジット（予約時にオンライン決済・残額は後日）';
export const DEPOSIT_PAYMENT_NOTE = '予約時に一部（デポジット）をクレジットカードでお支払い（Stripe）。残額は後日精算';
export const isDepositPaymentOption = (id: string | null | undefined) => id === DEPOSIT_PAYMENT_OPTION;

// 支払方法の表示名。自由入力の支払方法（customPaymentOptions）は設定を渡すと名前を引ける。
export const paymentOptionLabel = (id: string, s?: Pick<PartnerBookingSettings, 'customPaymentOptions'> | null) =>
  isDepositPaymentOption(id)
    ? DEPOSIT_PAYMENT_LABEL
    : (PARTNER_PAYMENT_OPTIONS.find((o) => o.id === id)?.label ?? s?.customPaymentOptions.find((o) => o.id === id)?.label ?? id);
// Stripe を使う支払方法
export const isStripePaymentOption = (id: string) => id === 'online' || id === 'online_checkin' || id === DEPOSIT_PAYMENT_OPTION;

// 自由入力の支払方法（2026-10-01 指示）。例: 「現地精算（法人カード）」「請求書払い（20日締め翌月10日）」。
// 決済は伴わず、後払い（invoice_monthly）と同じく予約はその場で確定し、名前が PMS の支払方法・備考に入る。
// id は 'custom_' で始める（PMS の電文 payment.option にもそのまま載るが、PMS は入金行を立てない）。
// billable: 月次の請求書で「ご請求」する（振込を求める）か。後払い（invoice_monthly）は常に対象（2026-10-01 指示）。
export type PartnerCustomPaymentOption = { id: string; label: string; note: string; billable: boolean };
export const CUSTOM_PAYMENT_PREFIX = 'custom_';
export const MAX_CUSTOM_PAYMENT_OPTIONS = 5;
export const isCustomPaymentOption = (id: string) => id.startsWith(CUSTOM_PAYMENT_PREFIX);

// 取引先の画面に出す支払方法の一覧（固定の3種＋自由入力。並びは固定 → 自由入力）。
export function partnerPaymentChoices(s: Pick<PartnerBookingSettings, 'customPaymentOptions'>): { id: string; label: string; note: string }[] {
  return [...PARTNER_PAYMENT_OPTIONS, ...s.customPaymentOptions];
}

// ---- 月次のご請求書（2026-10-02 指示: 支払期限は取引先ごと・宛名は正式社名を別に設定） ----
// 支払期限: 翌月末 / 翌月 N 日（1〜28。29日以降は月により無いので 28 まで）
export type PartnerInvoiceDue = { type: 'next_month_end' } | { type: 'next_month_day'; day: number };
export const DEFAULT_INVOICE_DUE: PartnerInvoiceDue = { type: 'next_month_end' };

export function normalizeInvoiceDue(raw: unknown): PartnerInvoiceDue {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (src.type !== 'next_month_day') return { ...DEFAULT_INVOICE_DUE };
  const day = Math.round(Number(src.day));
  return Number.isFinite(day) && day >= 1 && day <= 28 ? { type: 'next_month_day', day } : { ...DEFAULT_INVOICE_DUE };
}

export const describeInvoiceDue = (d: PartnerInvoiceDue) => (d.type === 'next_month_end' ? '翌月末' : `翌月${d.day}日`);

// 対象月（YYYY-MM-01）の支払期限（YYYY-MM-DD）。
export function invoiceDueDate(period: string, d: PartnerInvoiceDue): string {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)); // 翌月末
  const day = d.type === 'next_month_end' ? last.getUTCDate() : Math.min(d.day, last.getUTCDate());
  return `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ---- 取引先特典（2026-10-01 指示: 取引先専用ページから予約したときだけ付く特典） ----
// planCodes が空なら全プラン。プランを絞ると「取引先専用プラン」として見せられる。
// 特典は予約の要望（PMS の「事前質問・要望」）・確認メールに「取引先特典」として載り、宿が当日提供する。
// imageUrl（2026-10-03 追加）: 取引先の画面に出す画像（book-photos バケットの公開URL）。空なら画像なし。
export type PartnerPerk = { id: string; title: string; description: string; imageUrl: string; planCodes: string[] };
export const MAX_PARTNER_PERKS = 10;
export const perksForPlan = <T extends { planCodes: string[] }>(perks: T[], planCode: string | null | undefined) =>
  perks.filter((p) => !p.planCodes.length || (!!planCode && p.planCodes.includes(planCode)));
// 予約の要望・メールに載せる1行（例: 「ウェルカムドリンク／館内利用券 1,000円」）
// ---- 取引先向けのプラン名（2026-10-03 指示: 取引先ごとに独自のレート・特典を付けるので、名前も取引先専用にする） ----
// キーはプランコード（a003 等。特典の対象プランと同じ）。空なら PMS のプラン名から作る既定の表示名（displayPlanName）。
// 取引先ページ・取引先宛てメール・請求書に出す。PMS・宿への記録（plan_name）は元の名前のまま。
export const MAX_PLAN_NAME_LENGTH = 60;
export function partnerPlanName(planNames: Record<string, string> | undefined, planCode: string | null | undefined, rawName: string): string {
  const custom = planCode ? (planNames?.[planCode] ?? '').trim() : '';
  return custom || displayPlanName(rawName);
}

export const describePerks = (perks: { title: string }[]) => perks.map((p) => p.title).join('／');

// ---- 予約者（取引先の予約担当者。2026-10-01 指示） ----
// マイページ（rms_partner_accounts.booker_profile）で設定し、予約フォームの「予約者」に既定で出す。
// 予約確認・取消・決済に関するメールは宿泊者ではなく予約者へ送る（宿泊者のメールには何も送らない）。
export type PartnerBooker = { name: string; kana: string; department: string; phone: string; email: string };
export const EMPTY_BOOKER: PartnerBooker = { name: '', kana: '', department: '', phone: '', email: '' };

export function normalizeBooker(raw: unknown): PartnerBooker {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (k: string, max: number) => String(src[k] ?? '').trim().slice(0, max);
  return { name: s('name', 60), kana: s('kana', 60), department: s('department', 60), phone: s('phone', 20), email: s('email', 254) };
}

// 予約時の予約者の検証（氏名・メール必須。メールは確認メールの宛先）。
export function validateBooker(b: PartnerBooker): string | null {
  if (!b.name) return 'ご予約者（ご担当者）のお名前を入力してください。';
  if (!b.email) return 'ご予約者（ご担当者）のメールアドレスを入力してください。予約確認メールの宛先になります。';
  if (!EMAIL_RE.test(b.email)) return 'ご予約者のメールアドレスの形式が正しくありません。';
  if (b.phone && !/^[0-9+\-() ]{8,20}$/.test(b.phone)) return 'ご予約者の電話番号を正しく入力してください。';
  return null;
}

// 予約の要望（PMS）・メールに載せる1行（例: 「山田 太郎（総務部）03-1234-5678 / yamada@example.com」）
export function describeBooker(b: PartnerBooker): string {
  const head = `${b.name}${b.department ? `（${b.department}）` : ''}`;
  return [head, b.phone, b.email].filter(Boolean).join(' / ');
}

// ---- 交通手段（宿泊者情報。2026-10-01 指示: JR・車・その他（自由入力）から選ぶ） ----
export type PartnerTransportId = 'jr' | 'car' | 'other';
export const PARTNER_TRANSPORT_OPTIONS: { id: PartnerTransportId; label: string }[] = [
  { id: 'jr', label: 'JR' },
  { id: 'car', label: '車' },
  { id: 'other', label: 'その他' }
];

// 交通手段の入力を表示用の文字列にする（未選択は ''。その他は自由入力があれば「その他（○○）」）。
export function resolveTransport(id: string, other: string): { ok: true; value: string } | { ok: false; message: string } {
  const v = String(id ?? '').trim();
  if (!v) return { ok: true, value: '' };
  const opt = PARTNER_TRANSPORT_OPTIONS.find((o) => o.id === v);
  if (!opt) return { ok: false, message: '交通手段の選択肢が正しくありません。' };
  if (opt.id !== 'other') return { ok: true, value: opt.label };
  const text = String(other ?? '').trim().slice(0, 60);
  if (!text) return { ok: false, message: '交通手段（その他）の内容を入力してください。' };
  return { ok: true, value: `その他（${text}）` };
}

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

// 画面・メール・PMS 備考用の説明（例: 「5%引き」「1名あたり1泊 1,000円引き」）。
export function describePrepayDiscount(d: PrepayDiscount): string {
  if (!hasPrepayDiscount(d)) return '';
  return d.type === 'percent' ? `${d.value}%引き` : `1名あたり1泊 ${d.value.toLocaleString('ja-JP')}円引き`;
}

// ---- デポジット（Phase 3b・受付枠を超えた予約。docs/partner-pms-customer-link.md §5.3・決定 #2・N2 N3 N6） ----
// 額の決め方（取引先ごと・booking_settings.creditDeposit）。請求額（宿泊料金＋入湯税）を超えない。予約時決済割引は付けない（N6）。
//   percent      … floor(請求額 × 率 / 100)（既定 30%）
//   yen_per_room … 円 × 室数
//   first_night  … 1泊目の宿泊料金（全部屋ぶん）＋入湯税の1泊ぶん
// DB 関数 public._rms_partner_deposit_amount（autumn-shared 20261007002617）と同じ規則。片方だけ変えないこと。
export type CreditDepositType = 'percent' | 'yen_per_room' | 'first_night';
export type CreditDeposit = { type: CreditDepositType; value: number };
export const DEFAULT_CREDIT_DEPOSIT: CreditDeposit = { type: 'percent', value: 30 };
export const CREDIT_DEPOSIT_TYPES: readonly { id: CreditDepositType; label: string; unit: string; note: string }[] = [
  { id: 'percent', label: '定率', unit: '%', note: '宿泊料金＋入湯税の N%（円未満切り捨て）' },
  { id: 'yen_per_room', label: '1室あたりの額', unit: '円/室', note: 'N 円 × 室数（請求額を超えない）' },
  { id: 'first_night', label: '1泊分', unit: '', note: '1泊目の宿泊料金（全部屋ぶん）＋入湯税の1泊ぶん' }
];
// 残額の精算先: invoice（月末の請求書で取引先へ）/ onsite（現地でお客様が払う）
export type CreditDepositRemainder = 'invoice' | 'onsite';

export function normalizeCreditDeposit(raw: unknown): CreditDeposit {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const n = Math.round(Number(src.value));
  if (src.type === 'first_night') return { type: 'first_night', value: 0 };
  if (src.type === 'yen_per_room' && Number.isFinite(n) && n >= 1) return { type: 'yen_per_room', value: Math.min(1_000_000, n) };
  if (src.type === 'percent' && Number.isFinite(n) && n >= 1) return { type: 'percent', value: Math.min(100, n) };
  return { ...DEFAULT_CREDIT_DEPOSIT };
}

export const normalizeCreditDepositRemainder = (raw: unknown): CreditDepositRemainder | null =>
  raw === 'invoice' || raw === 'onsite' ? raw : null;

/** 「宿泊料金＋入湯税の30%」「1室あたり 10,000円」「1泊分」 */
export function describeCreditDeposit(d: CreditDeposit): string {
  if (d.type === 'yen_per_room') return `1室あたり ${d.value.toLocaleString('ja-JP')}円`;
  if (d.type === 'first_night') return '1泊分（1泊目の宿泊料金＋入湯税）';
  return `宿泊料金＋入湯税の${d.value}%`;
}

// 取引先が使える「請求書で精算する」支払方法（月末締め・billable な自由入力）。定義の順で最初のもの
function billablePaymentIdOf(s: Pick<PartnerBookingSettings, 'paymentOptions' | 'customPaymentOptions'>): string | null {
  if (s.paymentOptions.includes('invoice_monthly')) return 'invoice_monthly';
  return s.customPaymentOptions.find((o) => o.billable && s.paymentOptions.includes(o.id))?.id ?? null;
}

/** 残額の精算先（設定が無ければ: 請求書払いの支払方法があれば invoice、無ければ onsite）。 */
export function depositRemainderModeOf(
  s: Pick<PartnerBookingSettings, 'paymentOptions' | 'customPaymentOptions' | 'creditDepositRemainder'>
): CreditDepositRemainder {
  return s.creditDepositRemainder ?? (billablePaymentIdOf(s) ? 'invoice' : 'onsite');
}

/** 台帳の remainder_option に写す ID（invoice_monthly / custom_* / onsite）。DB 関数 _rms_partner_deposit_remainder と同じ規則。 */
export function depositRemainderIdOf(s: Pick<PartnerBookingSettings, 'paymentOptions' | 'customPaymentOptions' | 'creditDepositRemainder'>): string {
  if (depositRemainderModeOf(s) === 'onsite') return 'onsite';
  return billablePaymentIdOf(s) ?? 'invoice_monthly';
}

/** 予約の残額を請求書で受けるか（remainder_option が onsite 以外）。予約時のスナップショットで判断する（設定を後から変えても動かない）。 */
export const isDepositRemainderBilled = (remainderOption: string | null | undefined) => !!remainderOption && remainderOption !== 'onsite';

export const depositRemainderText = (billed: boolean) => (billed ? '月末の請求書で貴社へご請求' : '現地でご精算');

/** 1泊目の宿泊料金（全部屋ぶん＝その日の単価 × 人数の合計）。 */
export function firstNightLodgingOf(rooms: { adults: number; nights: { date: string; unit_price: number }[] }[], checkIn: string): number {
  return rooms.reduce((s, r) => s + r.nights.filter((n) => n.date === checkIn).reduce((t, n) => t + n.unit_price, 0) * r.adults, 0);
}

/** デポジットの額（請求額を超えない・1円以上）。lodging は割引前の宿泊料金。 */
export function depositAmountOf(
  d: CreditDeposit,
  b: { lodging: number; bathTax: number; rooms: number; nights: number; firstNight: number }
): number {
  const dep = normalizeCreditDeposit(d);
  const base = Math.max(0, b.lodging + b.bathTax);
  let amount: number;
  if (dep.type === 'yen_per_room') amount = dep.value * Math.max(1, b.rooms);
  else if (dep.type === 'first_night') amount = b.firstNight + Math.floor(b.bathTax / Math.max(1, b.nights));
  else amount = Math.floor((base * dep.value) / 100);
  return Math.max(Math.min(amount, base), Math.min(1, base));
}

export type PartnerBookingSettings = {
  // 許可する支払方法（1つ以上）。固定の3種（PartnerPaymentOptionId）か自由入力（customPaymentOptions の id）。
  paymentOptions: string[];
  // 自由入力の支払方法の定義（最大5つ）。選べるかどうかは paymentOptions に id を入れて決める。
  customPaymentOptions: PartnerCustomPaymentOption[];
  // 取引先特典（最大10）。
  perks: PartnerPerk[];
  // 取引先向けのプラン名（プランコード → 名前）。無いプランは既定の表示名。
  planNames: Record<string, string>;
  // 月次のご請求書の宛名（正式社名。空なら取引先名）と支払期限。
  invoiceRecipientName: string;
  invoiceDue: PartnerInvoiceDue;
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
  // 公式HP限定特典（紹介文テンプレートの「特典」）を取引先ページにも出すか。既定は出さない（公式HPからの予約の特典のため）。
  showOfficialPerks: boolean;
  // 受付枠（与信）を超えた予約のデポジット（Phase 3b）。額の決め方（既定は定率 30%・N2）
  creditDeposit: CreditDeposit;
  // デポジットの残額の精算先。null = 既定（請求書払いの支払方法があれば請求書、無ければ現地）
  creditDepositRemainder: CreditDepositRemainder | null;
  // ---- 団体予約（照会 → 宿が回答 → 承諾で予約・docs/partner-group-booking.md §5.3・2026-10-10）。取引先共通 ----
  // 団体予約のメニューを出すか（kind=agent のときだけ意味を持つ・既定オフ＝取引先ごとに管理画面でオンにする・2026-10-10 変更）
  groupInquiryEnabled: boolean;
  // 1件の室数・泊数の上限、一括送信の件数の上限（個人予約の maxRooms / maxNights は見ない）
  groupMaxRooms: number;
  groupMaxNights: number;
  groupMaxBatch: number;
  // 受付締切: チェックイン日の N 日前まで照会できる（締切の時刻は cutoffHour）
  groupLeadDays: number;
  // 交通機関・夕食開始時間の選択肢（＋「その他」の自由記入は常にある）
  groupTransportChoices: string[];
  groupDinnerTimeChoices: string[];
  // 回答の有効期限の既定（日・宿が回答時に変えられる）
  groupAnswerDays: number;
  // ---- 特別会員の専用ページ（kind='member'・docs/vip-member-page.md §6.3・D1）。施設ごと（PARTNER_FACILITY_SETTING_KEYS） ----
  // キャンセル方式（お客さまに有利な方〔既定〕／専用ページの規定／会員グレードの規定）と、専用ページの規定（rate は 0〜1）
  cancelPolicyMode: CancelPolicyMode;
  cancelRules: MemberCancelRule[];
};

export const DEFAULT_PARTNER_BOOKING_SETTINGS: PartnerBookingSettings = {
  paymentOptions: ['invoice_monthly'],
  customPaymentOptions: [],
  perks: [],
  planNames: {},
  invoiceRecipientName: '',
  invoiceDue: { type: 'next_month_end' },
  prepayDiscount: { type: 'none', value: 0 },
  leadDays: 1,
  cutoffHour: 18,
  maxRooms: 5,
  maxNights: 7,
  cancelDays: 1,
  notice: '',
  options: [],
  notifyEmails: [],
  notifyPartner: true,
  showOfficialPerks: false,
  creditDeposit: { type: 'percent', value: 30 },
  creditDepositRemainder: null,
  groupInquiryEnabled: false,
  groupMaxRooms: 30,
  groupMaxNights: 7,
  groupMaxBatch: 20,
  groupLeadDays: 3,
  groupTransportChoices: ['大型バス1台', '中型バス1台', 'マイクロバス1台', 'JR', '自家用車'],
  groupDinnerTimeChoices: ['17:30', '18:00', '18:30', '19:00'],
  groupAnswerDays: 7,
  cancelPolicyMode: 'favorable',
  cancelRules: []
};

// 団体予約の選択肢（交通機関・夕食開始時間）の正規化: 前後の空白を落とし、空・重複を除き、1件 30 字・最大 12 件。
// 配列でなければ既定、空配列はそのまま（「その他」の自由記入だけにする）
export const MAX_GROUP_CHOICES = 12;
function normalizeGroupChoices(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  return [...new Set(raw.map((v) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)).filter(Boolean))].slice(0, MAX_GROUP_CHOICES);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// 特典画像の URL は https のものだけ受ける（javascript: などを画面に出さない）。
function perkImageUrl(v: unknown): string {
  const s = String(v ?? '').trim();
  return /^https:\/\/[^\s"'<>]+$/.test(s) && s.length <= 500 ? s : '';
}

// ---- 取引先共通と施設ごとの振り分け（複数施設化・docs/partner-multi-facility.md §4.2・2026-10-09） ----
//
// rms_partners.booking_settings（取引先共通）と rms_partner_facilities.facility_settings（施設ごと）の2つの jsonb を
// 1つの PartnerBookingSettings に合成する。規則は SQL の _rms_partner_effective_settings（common || facility）と同じ:
// facility_settings に「キーがあれば」施設の値、無ければ共通の値（0・空文字・[]・false・null も「値あり」として上書きする）。
// prepayDiscount はオブジェクトごと上書き（type と value を別々に継承しない・M6）。

/** 施設ごとにだけ持つキー（施設のプラン・特典・案内・通知先）。保存時は常に facility_settings へ */
export const PARTNER_FACILITY_SETTING_KEYS = ['planNames', 'perks', 'notice', 'notifyEmails', 'showOfficialPerks'] as const;
/**
 * 特別会員の専用ページ（kind='member'）だけが使う、施設ごとにだけ持つキー（キャンセル方式と専用ページの規定・docs/vip-member-page.md §13.1 Z14）。
 * 保存時は施設（facility_settings）へ。施設タブのフォームに無ければ今の値のまま（取引先の施設タブは送らない）
 */
export const PARTNER_FACILITY_MEMBER_KEYS = ['cancelPolicyMode', 'cancelRules'] as const;
/** 共通の既定を施設で上書きできるキー（決定 N6）。既定は共通に置き、施設で上書きしているときだけ facility_settings へ */
export const PARTNER_FACILITY_OVERRIDE_KEYS = ['prepayDiscount', 'leadDays', 'cutoffHour', 'maxRooms', 'maxNights', 'cancelDays'] as const;

export type PartnerFacilitySettingKey = (typeof PARTNER_FACILITY_SETTING_KEYS)[number];
export type PartnerFacilityMemberKey = (typeof PARTNER_FACILITY_MEMBER_KEYS)[number];
export type PartnerFacilityOverrideKey = (typeof PARTNER_FACILITY_OVERRIDE_KEYS)[number];

const asSettingsObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * 共通と施設の jsonb を、SQL の `common || facility` と同じ規則で1つにする（正規化の前の生の合成）。
 * JS の undefined は JSON に残らない（DB では「キーが無い」と同じ）ので、上書きしない。
 */
export function mergePartnerSettingsRaw(common: unknown, facility?: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { ...asSettingsObject(common) };
  for (const [k, v] of Object.entries(asSettingsObject(facility))) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * 保存時の振り分け: 正規化済みの設定を、取引先共通（rms_partners.booking_settings）と施設（facility_settings）に分ける。
 * 施設ごとのキー（PARTNER_FACILITY_SETTING_KEYS）は施設へ。N6 の上書きキーは既定で共通へ置き、
 * overriddenKeys（いまその施設で上書きしているキー）に入っているものだけ施設へ置く（画面で見せた値＝施設の値を施設に戻す）。
 */
export function splitPartnerBookingSettings(
  settings: PartnerBookingSettings,
  overriddenKeys: Iterable<string> = []
): { common: Record<string, unknown>; facility: Record<string, unknown> } {
  const overridden = new Set(overriddenKeys);
  const facilityKeys = new Set<string>([
    ...PARTNER_FACILITY_SETTING_KEYS,
    ...PARTNER_FACILITY_MEMBER_KEYS,
    ...PARTNER_FACILITY_OVERRIDE_KEYS.filter((k) => overridden.has(k))
  ]);
  const common: Record<string, unknown> = {};
  const facility: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (facilityKeys.has(k)) facility[k] = v;
    else common[k] = v;
  }
  return { common, facility };
}

/** facility_settings で上書きしている N6 のキー（キーの有無で判定。値が 0 や空でも上書き） */
export function partnerFacilityOverrides(facility: unknown): PartnerFacilityOverrideKey[] {
  const src = asSettingsObject(facility);
  return PARTNER_FACILITY_OVERRIDE_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined);
}

// ---- 管理画面の施設タブ（複数施設化 S3・§7.12・2026-10-09） ----

/** 施設で上書きしている N6 の値（キーがある = この施設だけ変える。値が 0・空・null でも上書き） */
export type PartnerFacilityOverrides = Partial<Pick<PartnerBookingSettings, PartnerFacilityOverrideKey>>;
/** 施設ごとにだけ持つ値（プラン名・特典・案内文・通知先・公式特典）。特別会員のキャンセル方式・規定は送ったときだけ */
export type PartnerFacilityOwnSettings = Pick<PartnerBookingSettings, PartnerFacilitySettingKey> &
  Partial<Pick<PartnerBookingSettings, PartnerFacilityMemberKey>>;

/**
 * facility_settings（または施設タブの画面から来た上書き）から、上書きしている N6 のキーと値（正規化済み）を取り出す。
 * キーがあるものだけ「この施設だけ変える」、無いものは「共通の既定を使う」。値の 0・空文字・null（cancelDays の
 * 「画面からは不可」）も上書きとして残す（N6・キーの有無で判定）。
 */
export function readPartnerFacilityOverrides(facility: unknown): PartnerFacilityOverrides {
  const src = asSettingsObject(facility);
  const keys = partnerFacilityOverrides(src);
  if (!keys.length) return {};
  // 1キーずつ正規化する（他のキーの既定値を混ぜない）
  const normalized = normalizePartnerBookingSettings(Object.fromEntries(keys.map((k) => [k, src[k]])));
  return Object.fromEntries(keys.map((k) => [k, normalized[k]])) as PartnerFacilityOverrides;
}

/**
 * 施設タブの保存で書く facility_settings を作る。施設ごとのキーは画面の値で置き換え、N6 のキーは
 * 上書きしているものだけ書き、「共通の既定を使う」のキーは消す。知らないキー（将来のキー）は今の値のまま残す。
 */
export function buildPartnerFacilitySettings(
  current: unknown,
  own: PartnerFacilityOwnSettings,
  overrides: PartnerFacilityOverrides
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...asSettingsObject(current) };
  for (const k of PARTNER_FACILITY_OVERRIDE_KEYS) delete out[k];
  for (const k of PARTNER_FACILITY_SETTING_KEYS) out[k] = own[k];
  for (const k of PARTNER_FACILITY_MEMBER_KEYS) if (own[k] !== undefined) out[k] = own[k];
  for (const k of PARTNER_FACILITY_OVERRIDE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(overrides, k) && overrides[k] !== undefined) out[k] = overrides[k];
  }
  return out;
}

/** N6 の項目名（管理画面の施設タブ） */
export const PARTNER_FACILITY_OVERRIDE_LABELS: Record<PartnerFacilityOverrideKey, string> = {
  prepayDiscount: '予約時決済の割引（早期決済割）',
  leadDays: '予約の締切',
  cutoffHour: '締切の時刻',
  cancelDays: '取引先による取消',
  maxRooms: '最大室数',
  maxNights: '最大泊数'
};

/** N6 の値の説明（施設タブの「共通の既定を使う（値）」に出す） */
export function describePartnerFacilityOverride(key: PartnerFacilityOverrideKey, s: Pick<PartnerBookingSettings, PartnerFacilityOverrideKey>): string {
  const day = (d: number) => (d === 0 ? '当日' : `${d}日前`);
  switch (key) {
    case 'prepayDiscount':
      return describePrepayDiscount(s.prepayDiscount) || 'なし';
    case 'leadDays':
      return day(s.leadDays);
    case 'cutoffHour':
      return `${s.cutoffHour}時まで`;
    case 'cancelDays':
      return s.cancelDays == null ? '画面からは不可' : `${day(s.cancelDays)}の同時刻まで`;
    case 'maxRooms':
      return `${s.maxRooms}室`;
    case 'maxNights':
      return `${s.maxNights}泊`;
  }
}

/**
 * 共通セクションの保存で書く rms_partners.booking_settings を作る。施設ごとのキー以外（N6 の既定を含む）は画面の値、
 * 施設ごとのキーは今の共通の jsonb にあればそのまま残す（Phase D まで残る旧い値・巻き戻し時の互換。画面からは書かない）。
 */
export function buildPartnerCommonSettings(current: unknown, settings: PartnerBookingSettings): Record<string, unknown> {
  const cur = asSettingsObject(current);
  const legacy = Object.fromEntries(PARTNER_FACILITY_SETTING_KEYS.filter((k) => k in cur).map((k) => [k, cur[k]]));
  return { ...legacy, ...splitPartnerBookingSettings(settings, []).common };
}

// DB の jsonb / 画面からの入力を、欠けや不正値を補って正規形にする（保存前・読込時の両方で通す）。
// facility を渡すと、取引先共通（raw）に施設の設定を重ねてから正規化する（上の mergePartnerSettingsRaw・決定 N6）。
export function normalizePartnerBookingSettings(raw: unknown, facility?: unknown): PartnerBookingSettings {
  const src = facility === undefined ? asSettingsObject(raw) : mergePartnerSettingsRaw(raw, facility);
  const d = DEFAULT_PARTNER_BOOKING_SETTINGS;
  const options: PartnerBookingOption[] = normalizeBookingQuestions(src.options);
  const emails = Array.isArray(src.notifyEmails)
    ? [...new Set(src.notifyEmails.map((e) => String(e ?? '').trim()).filter((e) => EMAIL_RE.test(e)))].slice(0, 10)
    : [];
  const cancelDays =
    src.cancelDays === null || src.cancelDays === '' ? null : src.cancelDays === undefined ? d.cancelDays : clampInt(src.cancelDays, 0, 90, 1);
  const customRaw = Array.isArray(src.customPaymentOptions) ? src.customPaymentOptions : [];
  const usedCustomIds = new Set<string>();
  const customPaymentOptions: PartnerCustomPaymentOption[] = customRaw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .map((o, i) => {
      let id = String(o.id ?? '').trim();
      if (!/^custom_[a-z0-9_-]{1,40}$/i.test(id)) id = `${CUSTOM_PAYMENT_PREFIX}${i + 1}`;
      while (usedCustomIds.has(id)) id = `${id}_`;
      usedCustomIds.add(id);
      return {
        id,
        label: String(o.label ?? '').trim().slice(0, 40),
        note: String(o.note ?? '').trim().slice(0, 200),
        billable: o.billable === true
      };
    })
    .filter((o) => o.label)
    .slice(0, MAX_CUSTOM_PAYMENT_OPTIONS);
  // 並びは固定の3種 → 自由入力（定義の順）。定義に無い id（削除された自由入力など）は落とす。
  const payIds = [...PARTNER_PAYMENT_OPTIONS.map((o) => o.id as string), ...customPaymentOptions.map((o) => o.id)];
  const paymentOptions = Array.isArray(src.paymentOptions)
    ? payIds.filter((id) => (src.paymentOptions as unknown[]).includes(id))
    : [...d.paymentOptions];
  const perksRaw = Array.isArray(src.perks) ? src.perks : [];
  const perks: PartnerPerk[] = perksRaw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p, i) => ({
      id: String(p.id ?? '').trim().slice(0, 40) || `perk-${i + 1}`,
      title: String(p.title ?? '').trim().slice(0, 60),
      description: String(p.description ?? '').trim().slice(0, 500),
      imageUrl: perkImageUrl(p.imageUrl),
      planCodes: Array.isArray(p.planCodes) ? [...new Set(p.planCodes.map((c) => String(c ?? '').trim()).filter(Boolean))].slice(0, 50) : []
    }))
    .filter((p) => p.title)
    .slice(0, MAX_PARTNER_PERKS);
  const planNames: Record<string, string> = {};
  const namesRaw = src.planNames && typeof src.planNames === 'object' && !Array.isArray(src.planNames) ? (src.planNames as Record<string, unknown>) : {};
  for (const [code, name] of Object.entries(namesRaw).slice(0, 100)) {
    const c = code.trim();
    const n = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_PLAN_NAME_LENGTH);
    if (/^[A-Za-z0-9_-]{1,20}$/.test(c) && n) planNames[c] = n;
  }
  return {
    paymentOptions,
    customPaymentOptions,
    perks,
    planNames,
    invoiceRecipientName: String(src.invoiceRecipientName ?? '').trim().slice(0, 120),
    invoiceDue: normalizeInvoiceDue(src.invoiceDue),
    prepayDiscount: normalizePrepayDiscount(src.prepayDiscount),
    leadDays: clampInt(src.leadDays, 0, 90, d.leadDays),
    cutoffHour: clampInt(src.cutoffHour, 0, 23, d.cutoffHour),
    maxRooms: clampInt(src.maxRooms, 1, 20, d.maxRooms),
    maxNights: clampInt(src.maxNights, 1, 30, d.maxNights),
    cancelDays,
    notice: String(src.notice ?? '').trim().slice(0, 1000),
    options,
    notifyEmails: emails,
    notifyPartner: src.notifyPartner === undefined ? d.notifyPartner : src.notifyPartner === true,
    showOfficialPerks: src.showOfficialPerks === true,
    creditDeposit: normalizeCreditDeposit(src.creditDeposit),
    creditDepositRemainder: normalizeCreditDepositRemainder(src.creditDepositRemainder),
    groupInquiryEnabled: src.groupInquiryEnabled === true,
    groupMaxRooms: clampInt(src.groupMaxRooms, 1, 100, d.groupMaxRooms),
    groupMaxNights: clampInt(src.groupMaxNights, 1, 30, d.groupMaxNights),
    groupMaxBatch: clampInt(src.groupMaxBatch, 1, 50, d.groupMaxBatch),
    groupLeadDays: clampInt(src.groupLeadDays, 0, 90, d.groupLeadDays),
    groupTransportChoices: normalizeGroupChoices(src.groupTransportChoices, d.groupTransportChoices),
    groupDinnerTimeChoices: normalizeGroupChoices(src.groupDinnerTimeChoices, d.groupDinnerTimeChoices),
    groupAnswerDays: clampInt(src.groupAnswerDays, 1, 60, d.groupAnswerDays),
    cancelPolicyMode: normalizeCancelPolicyMode(src.cancelPolicyMode),
    cancelRules: normalizeCancelRules(src.cancelRules)
  };
}

// 保存時の検証（normalize で吸収できない入力ミス）。
// kind: 取引先の種別。特別会員（member）は公式予約の支払方法を使うので、支払方法が無くても予約受付をオンにできる（Z12）
export function validatePartnerBookingSettings(s: PartnerBookingSettings, bookingEnabled = false, kind?: string): string | null {
  if (bookingEnabled && kind !== 'member' && !s.paymentOptions.length) return '予約を受け付けるときは、支払方法を1つ以上選んでください。';
  const q = validateBookingQuestions(s.options);
  return q ? `この取引先だけ追加で聞く項目 — ${q}` : null;
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

// 追加オプションの回答を検証して {label, value} の並びにする（lib/booking-questions.ts と同じもの）。
export const resolveOptionAnswers = resolveQuestionAnswers;

// ---------------------------------------------------------------------------
// オンライン決済の金額（サーバ・画面共通の純関数）
// ---------------------------------------------------------------------------

// 請求額 = 宿泊料金＋入湯税。キャンセル料の基準は宿泊料金（total_amount）だけ。
// 請求額＝宿泊料金（割引前）＋入湯税−予約時決済の割引
export const chargeAmountOf = (b: { total_amount: number; bath_tax_amount?: number | null; prepay_discount_amount?: number | null }) =>
  b.total_amount + (b.bath_tax_amount ?? 0) - (b.prepay_discount_amount ?? 0);

type DepositSource = {
  total_amount: number;
  bath_tax_amount?: number | null;
  prepay_discount_amount?: number | null;
  payment_option?: string | null;
  deposit_amount?: number | null;
  paid_amount?: number | null;
};

/**
 * 予約時の PaymentIntent で受け取る額。デポジット（deposit_online）は台帳の deposit_amount（DB 関数が計算した額）、
 * それ以外は請求額（chargeAmountOf）。mark_paid の金額の検証も同じ額で。
 */
export const intentAmountOf = (b: DepositSource) =>
  isDepositPaymentOption(b.payment_option) && (b.deposit_amount ?? 0) > 0 ? (b.deposit_amount as number) : chargeAmountOf(b);

/** デポジット予約の受け取り済みの額と残額。デポジットでなければ null。 */
export function depositStateOf(b: DepositSource): { deposit: number; remainder: number } | null {
  if (!isDepositPaymentOption(b.payment_option)) return null;
  const deposit = Math.max(0, b.paid_amount ?? b.deposit_amount ?? 0);
  return { deposit, remainder: Math.max(0, chargeAmountOf(b) - deposit) };
}

// 予約画面の見積もりから、選んだ支払方法での宿泊料金と請求額を出す。
// 予約時決済の割引（prepay）は予約時決済（online）を選んだときだけ効く。サーバが作る Intent の金額（chargeAmountOf）と同じになる。
export function quoteChargeOf(
  q: { total: number; bathTax: number; prepay: { total: number } | null },
  paymentOption: string
): { lodging: number; bathTax: number; charge: number; discounted: boolean } {
  const discounted = paymentOption === 'online' && !!q.prepay;
  const lodging = discounted && q.prepay ? q.prepay.total : q.total;
  return { lodging, bathTax: q.bathTax, charge: lodging + q.bathTax, discounted };
}

// 料金の明細の「1室1泊を1行」（2026-10-10 指示。2室2泊なら4行）。部屋ごと・泊ごとに「1名あたり × 人数」の内訳を作る。
// 並びは部屋の順 → 泊の日付順。room は 0 始まりの部屋の番号（複数室のとき「N室目」と出す）。
export type PartnerNightLine = { room: number; date: string; parts: { unit: number; adults: number }[]; amount: number };
export function partnerNightLines(rooms: { adults: number; nights: { date: string; unit_price: number }[] }[]): PartnerNightLine[] {
  return rooms.flatMap((r, room) =>
    [...r.nights]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((n) => ({ room, date: n.date, parts: [{ unit: n.unit_price, adults: r.adults }], amount: n.unit_price * r.adults }))
  );
}

// 料金の明細の見出し（2026-10-10 指示）: 泊ごとに「N泊目: M月D日（曜）」→ その下に部屋ごとの行。
export type PartnerNightGroup = { night: number; date: string; label: string; lines: PartnerNightLine[] };
const NIGHT_WEEK = ['日', '月', '火', '水', '木', '金', '土'];
export function partnerNightHeading(night: number, iso: string): string {
  const t = new Date(`${iso}T00:00:00Z`);
  return `${night}泊目: ${t.getUTCMonth() + 1}月${t.getUTCDate()}日（${NIGHT_WEEK[t.getUTCDay()]}）`;
}
export function groupNightLines(lines: PartnerNightLine[]): PartnerNightGroup[] {
  const dates = [...new Set(lines.map((l) => l.date))].sort();
  return dates.map((date, i) => ({
    night: i + 1,
    date,
    label: partnerNightHeading(i + 1, date),
    lines: lines.filter((l) => l.date === date).sort((a, b) => a.room - b.room)
  }));
}
/** 行の中身（例: 「1名様 83,000円 × 2名様」） */
export function partnerNightLineText(l: PartnerNightLine): string {
  return l.parts.map((p) => `1名様 ${p.unit.toLocaleString('ja-JP')}円 × ${p.adults}名様`).join(' ＋ ');
}
