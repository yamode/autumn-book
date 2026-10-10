// 取引先ページの団体予約（問い合わせ → 宿が回答 → 承諾で予約・docs/partner-group-booking.md）の純関数と型。
//
// サーバ（lib/server/partners/group-inquiries.ts）・取引先ページ・管理画面で共通に使う。DB・環境変数に触らないので
// 単体テストできる（partner-group.test.ts）。
//   - 団体予約を出すか（groupInquiryAvailable・kind='agent' の許可リスト方式・§7.10）
//   - 支払方法の候補（Stripe 系を除く・§7.4）
//   - 大人人数の均等割（§5.1・§7.1）・室数の目安
//   - 照会の入力の検証（§8.1）・受付締切
//   - 状態の遷移の可否・表示名（§6）
//   - 宿の回答の料金の組み立て（1名単価の上書き・合計の均等割・§7.2）
import {
  deadlineOf,
  describeBooker,
  isCustomPaymentOption,
  normalizeBooker,
  paymentOptionLabel,
  validateBooker,
  type PartnerBooker,
  type PartnerBookingSettings
} from '$lib/partner-booking';

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

/** 照会の状態（§6）。下書きはブラウザ内だけ（サーバには無い） */
export type GroupInquiryStatus = 'submitted' | 'offered' | 'declined' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';
export const GROUP_INQUIRY_STATUSES: readonly GroupInquiryStatus[] = ['submitted', 'offered', 'declined', 'accepted', 'rejected', 'withdrawn', 'expired'];

/** 宿の回答: 受けられる / 条件付きで受けられる / 受けられない */
export type GroupAnswer = 'ok' | 'conditional' | 'declined';
export const GROUP_ANSWERS: readonly GroupAnswer[] = ['ok', 'conditional', 'declined'];

/** 照会時点の自動計算の結果（§7.1） */
export type GroupQuoteStatus = 'ok' | 'no_rate' | 'closed' | 'capacity' | 'error';

/** 料金の部屋（部屋ごとの大人人数と泊ごとの1名単価）。RPC rms_partner_create_booking の rooms と同じ形（subtotal は表示用） */
export type GroupPriceRoom = { adults: number; nights: { date: string; unit_price: number }[]; subtotal?: number };

/** 「その他」の自由記入つきの選択（交通機関・夕食開始時間）。choice は選択肢の文字列・'other'・''（未選択） */
export type GroupChoiceInput = { choice: string; other: string };
export const GROUP_CHOICE_OTHER = 'other';

/** 照会の付帯情報（rms_partner_group_inquiries.extras）。value は表示・PMS 用に組み立てた文字列 */
export type GroupInquiryExtras = {
  transport: GroupChoiceInput & { value: string };
  dinnerTime: GroupChoiceInput & { value: string };
  note: string;
};

/**
 * 取引先が入力する照会の1件（ブラウザの下書きの1行・POST /p/[token]/group/submit の items[]）。
 * 1件＝1施設・1日程・1部屋タイプ・1プラン（§5.1）。planName は PMS の元のプラン名（料金の照合用・見積と同じ）。
 */
export type GroupDraftItem = {
  facilityId: string;
  groupName: string;
  roomCode: string;
  planCode: string;
  planName: string;
  checkIn: string;
  nights: number;
  /** 大人の合計（rooms の合計と一致すること） */
  adults: number;
  /** 部屋ごとの大人人数（長さ＝室数） */
  rooms: { adults: number }[];
  paymentOption: string;
  transport: GroupChoiceInput;
  dinnerTime: GroupChoiceInput;
  note: string;
  booker: PartnerBooker;
};

/** 団体予約の設定（booking_settings の group* キー・§5.3） */
export type GroupSettings = Pick<
  PartnerBookingSettings,
  | 'groupInquiryEnabled'
  | 'groupMaxRooms'
  | 'groupMaxNights'
  | 'groupMaxBatch'
  | 'groupLeadDays'
  | 'groupTransportChoices'
  | 'groupDinnerTimeChoices'
  | 'groupAnswerDays'
  | 'cutoffHour'
>;

export const groupSettingsOf = (s: PartnerBookingSettings): GroupSettings => ({
  groupInquiryEnabled: s.groupInquiryEnabled,
  groupMaxRooms: s.groupMaxRooms,
  groupMaxNights: s.groupMaxNights,
  groupMaxBatch: s.groupMaxBatch,
  groupLeadDays: s.groupLeadDays,
  groupTransportChoices: [...s.groupTransportChoices],
  groupDinnerTimeChoices: [...s.groupDinnerTimeChoices],
  groupAnswerDays: s.groupAnswerDays,
  cutoffHour: s.cutoffHour
});

export const MAX_GROUP_NAME_LENGTH = 60;
export const MAX_GROUP_NOTE_LENGTH = 500;
export const MAX_GROUP_ANSWER_MESSAGE_LENGTH = 1000;
/** 1室の人数の段（料金は大人1〜6名/室・§3.4）。これを超える部屋は料金が無い（no_rate） */
export const GROUP_MAX_ADULTS_PER_ROOM = 6;

// ---------------------------------------------------------------------------
// 団体予約を出すか・支払方法（§7.4・§7.10）
// ---------------------------------------------------------------------------

/** 団体予約の支払方法の候補: 許可された支払方法のうち後払い（invoice_monthly）と自由入力（custom_*）。Stripe 系は出さない（N3） */
export function groupPaymentChoices(s: Pick<PartnerBookingSettings, 'paymentOptions' | 'customPaymentOptions'>): { id: string; label: string }[] {
  return s.paymentOptions
    .filter((id) => id === 'invoice_monthly' || isCustomPaymentOption(id))
    .map((id) => ({ id, label: paymentOptionLabel(id, s) }));
}

/**
 * 団体予約を出す条件（純関数・2026-10-10 変更: 既定オフ・取引先ごとにオン）: kind が agent（許可リスト・将来の
 * member / ambassador では出ない）かつ groupInquiryEnabled（管理画面の取引先詳細で切る）。これだけでメニュー・画面・API を出す。
 * 照会を送れるか（施設の予約受付・支払方法）は groupInquiryBlockReason で別に見て、画面に理由を出す。
 */
export function groupInquiryAvailable(p: { kind: string; booking_settings: Pick<PartnerBookingSettings, 'groupInquiryEnabled'> }): boolean {
  return p.kind === 'agent' && p.booking_settings.groupInquiryEnabled === true;
}

/**
 * 選んでいる施設で照会を送れない理由（送れるなら null）。施設がオフ・予約受付がオフ・団体の支払方法（後払いか自由入力）が無い。
 */
export function groupInquiryBlockReason(p: {
  booking_settings: Pick<PartnerBookingSettings, 'paymentOptions' | 'customPaymentOptions'>;
  facility_available?: boolean;
  booking_enabled?: boolean;
}): string | null {
  if (p.facility_available === false) return '現在ご案内できる施設がありません。宿へお問い合わせください。';
  if (p.booking_enabled === false) return 'この施設では現在ご予約・団体のお問い合わせを受け付けていません。';
  if (!groupPaymentChoices(p.booking_settings).length) return '団体予約に使えるお支払方法が設定されていません。宿へお問い合わせください。';
  return null;
}

// ---------------------------------------------------------------------------
// 人数・室数
// ---------------------------------------------------------------------------

/** 大人 total 名を rooms 室に均等割（割り切れなければ先頭から +1）。例: 11名・5室 → [3,2,2,2,2] */
export function splitAdultsEvenly(total: number, rooms: number): number[] {
  const t = Math.max(0, Math.floor(total));
  const r = Math.max(0, Math.floor(rooms));
  if (!r) return [];
  const base = Math.floor(t / r);
  const extra = t - base * r;
  return Array.from({ length: r }, (_, i) => base + (i < extra ? 1 : 0));
}

/** 人数を入れたときの室数の目安（ceil(人数 / 部屋タイプの定員)・最低1） */
export function suggestRoomCount(adults: number, capacityMax: number): number {
  const cap = Math.max(1, Math.floor(capacityMax) || 1);
  return Math.max(1, Math.ceil(Math.max(1, Math.floor(adults) || 1) / cap));
}

// ---------------------------------------------------------------------------
// 選択肢＋その他（交通機関・夕食開始時間）
// ---------------------------------------------------------------------------

/** 選択＋その他を表示・PMS 用の文字列に。未選択は ''、その他は「その他（○○）」。選択肢に無い値・その他の空はエラー */
export function resolveGroupChoice(
  input: Partial<GroupChoiceInput> | null | undefined,
  choices: readonly string[],
  what: string
): { ok: true; value: string } | { ok: false; message: string } {
  const choice = String(input?.choice ?? '').trim();
  if (!choice) return { ok: true, value: '' };
  if (choice === GROUP_CHOICE_OTHER) {
    const text = String(input?.other ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!text) return { ok: false, message: `${what}（その他）の内容を入力してください。` };
    return { ok: true, value: `その他（${text}）` };
  }
  if (!choices.includes(choice)) return { ok: false, message: `${what}の選択肢が正しくありません。` };
  return { ok: true, value: choice };
}

// ---------------------------------------------------------------------------
// 受付締切・検証（§8.1）
// ---------------------------------------------------------------------------

/** 照会の締切（チェックイン日の groupLeadDays 日前の cutoffHour 時・JST） */
export const groupInquiryDeadline = (checkIn: string, s: Pick<GroupSettings, 'groupLeadDays' | 'cutoffHour'>) =>
  deadlineOf(checkIn, s.groupLeadDays, s.cutoffHour);

export const canInquireFor = (checkIn: string, s: Pick<GroupSettings, 'groupLeadDays' | 'cutoffHour'>, now = new Date()) =>
  now.getTime() < groupInquiryDeadline(checkIn, s).getTime();

/** 「チェックイン日の3日前の18時まで」 */
export const describeGroupDeadline = (s: Pick<GroupSettings, 'groupLeadDays' | 'cutoffHour'>) =>
  `チェックイン日の${s.groupLeadDays === 0 ? '当日' : `${s.groupLeadDays}日前`}の${s.cutoffHour}時まで`;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 実在する日付か（YYYY-MM-DD の形で、Date.parse して YYYY-MM-DD に戻すと一致する。2026-02-30・2026-13-01 は不可） */
export function isRealIsoDate(v: string | null | undefined): v is string {
  const s = String(v ?? '');
  if (!ISO_DATE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** DB の check（rms_partner_group_inquiries）に合わせた上限: 大人の合計・室数・泊数 */
export const GROUP_MAX_ADULT_TOTAL = 600;
export const GROUP_MAX_ROOM_COUNT = 100;
export const GROUP_MAX_NIGHTS_HARD = 30;
/** 回答の料金の上限: 1名1泊の単価は 1,000,000 円以下・宿泊料金の合計は 2,000,000,000 円未満 */
export const GROUP_MAX_UNIT_PRICE = 1_000_000;
export const GROUP_MAX_TOTAL_EXCLUSIVE = 2_000_000_000;

const addDays =(iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

export type GroupValidationIssue = { index: number; message: string };

/** 1件の入力を正規化（文字列の前後の空白・上限の切り詰め・数値の丸め）。検証の前に通す */
export function normalizeGroupDraftItem(raw: unknown): GroupDraftItem {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
  const n = (v: unknown) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? x : 0;
  };
  const choice = (v: unknown): GroupChoiceInput => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return { choice: s(o.choice, 40), other: s(o.other, 60) };
  };
  const rooms = Array.isArray(src.rooms) ? src.rooms.slice(0, 100).map((r) => ({ adults: n((r as { adults?: unknown })?.adults) })) : [];
  return {
    facilityId: s(src.facilityId, 40),
    groupName: s(src.groupName, 200).replace(/\s+/g, ' '),
    roomCode: s(src.roomCode, 40),
    planCode: s(src.planCode, 40),
    planName: s(src.planName, 200),
    checkIn: s(src.checkIn, 10),
    nights: n(src.nights),
    adults: n(src.adults),
    rooms,
    paymentOption: s(src.paymentOption, 60),
    transport: choice(src.transport),
    dinnerTime: choice(src.dinnerTime),
    note: String(src.note ?? '').trim().slice(0, MAX_GROUP_NOTE_LENGTH * 2),
    booker: normalizeBooker(src.booker)
  };
}

/**
 * 照会の束の検証（純関数・§8.1）。1件でも誤りがあれば送らない（部分送信にしない）ので、誤りを全部返す。
 *   bounds: 公開範囲（今日〜公開の最終日）。now: 締切の判定の時刻
 *   capacityOf: 部屋タイプの定員（pms.room_types.capacity_max）。知らない部屋は null（＝部屋タイプが見つからない）
 *   paymentIds: 団体の支払方法の候補（groupPaymentChoices の id）
 * warnings: 同じ日程・部屋タイプ・プランの重複（送れる）
 */
export function validateGroupDraft(
  items: readonly GroupDraftItem[],
  s: GroupSettings,
  ctx: {
    /** 公開範囲（施設ごとに違うので item ごとに引ける形も受ける） */
    bounds: { earliest: string; latest: string } | ((item: GroupDraftItem) => { earliest: string; latest: string });
    now?: Date;
    capacityOf: (item: GroupDraftItem) => number | null;
    paymentIds: readonly string[];
  }
): { ok: boolean; errors: GroupValidationIssue[]; warnings: GroupValidationIssue[] } {
  const errors: GroupValidationIssue[] = [];
  const warnings: GroupValidationIssue[] = [];
  const now = ctx.now ?? new Date();
  if (!items.length) errors.push({ index: -1, message: '送る照会がありません。' });
  if (items.length > s.groupMaxBatch) errors.push({ index: -1, message: `一度に送れるのは ${s.groupMaxBatch} 件までです。` });
  const seen = new Map<string, number>();
  items.forEach((it, index) => {
    const err = (message: string) => errors.push({ index, message });
    const bounds = typeof ctx.bounds === 'function' ? ctx.bounds(it) : ctx.bounds;
    if (!it.groupName) err('団体名を入力してください。');
    else if (it.groupName.length > MAX_GROUP_NAME_LENGTH) err(`団体名は ${MAX_GROUP_NAME_LENGTH} 文字以内で入力してください。`);
    if (!it.facilityId) err('施設を選んでください。');
    if (!it.roomCode) err('部屋タイプを選んでください。');
    if (!it.planCode || !it.planName) err('プラン（宿泊条件）を選んでください。');
    const maxNights = Math.min(s.groupMaxNights, GROUP_MAX_NIGHTS_HARD);
    const nightsOk = Number.isInteger(it.nights) && it.nights >= 1 && it.nights <= maxNights;
    if (!nightsOk) err(`泊数は 1〜${maxNights} 泊で入力してください。`);
    if (!ISO_DATE.test(it.checkIn)) err('チェックイン日を入力してください。');
    else if (!isRealIsoDate(it.checkIn)) err('チェックイン日が正しくありません。');
    else {
      if (it.checkIn < bounds.earliest) err('過去の日付は照会できません。');
      else if (!canInquireFor(it.checkIn, s, now)) err(`この日程の照会は締め切りました（${describeGroupDeadline(s)}）。`);
      if (nightsOk && addDays(it.checkIn, it.nights - 1) > bounds.latest) err('ご案内できる期間を超えています。チェックイン日・泊数をご確認ください。');
    }
    const roomCount = it.rooms.length;
    const maxRooms = Math.min(s.groupMaxRooms, GROUP_MAX_ROOM_COUNT);
    if (roomCount < 1 || roomCount > maxRooms) err(`室数は 1〜${maxRooms} 室で入力してください。`);
    const cap = it.roomCode ? ctx.capacityOf(it) : null;
    if (it.roomCode && cap == null) err('この部屋タイプは現在ご案内できません。');
    if (it.rooms.some((r) => !Number.isInteger(r.adults) || r.adults < 1)) err('部屋ごとの人数は1名以上で入力してください。');
    else if (cap != null && it.rooms.some((r) => r.adults > cap)) err(`1室の人数がお部屋の定員（${cap}名）を超えています。`);
    const sum = it.rooms.reduce((t, r) => t + (Number.isInteger(r.adults) ? r.adults : 0), 0);
    if (!Number.isInteger(it.adults) || it.adults < 1) err('大人の人数を入力してください。');
    else if (it.adults > GROUP_MAX_ADULT_TOTAL) err(`大人の人数は ${GROUP_MAX_ADULT_TOTAL} 名以内で入力してください。`);
    else if (roomCount >= 1 && sum !== it.adults) err(`部屋ごとの人数の合計（${sum}名）が大人の人数（${it.adults}名）と合いません。`);
    if (!ctx.paymentIds.includes(it.paymentOption)) err('お支払方法を選んでください。');
    const transport = resolveGroupChoice(it.transport, s.groupTransportChoices, '交通機関');
    if (!transport.ok) err(transport.message);
    const dinner = resolveGroupChoice(it.dinnerTime, s.groupDinnerTimeChoices, '夕食開始時間');
    if (!dinner.ok) err(dinner.message);
    if (it.note.length > MAX_GROUP_NOTE_LENGTH) err(`備考は ${MAX_GROUP_NOTE_LENGTH} 文字以内で入力してください。`);
    const booker = validateBooker(it.booker);
    if (booker) err(booker);
    // 宿泊者名義の取引先では予約者の電話が代表者の電話になる（RPC が電話を必須にしている・N5）
    else if (!it.booker.phone) err('ご予約者（ご担当者）の電話番号を入力してください。団体のご予約の連絡先になります。');
    const key = `${it.facilityId}|${it.checkIn}|${it.nights}|${it.roomCode}|${it.planCode}|${it.planName}`;
    const first = seen.get(key);
    if (first !== undefined) warnings.push({ index, message: `${first + 1}件目と同じ日程・部屋タイプ・プランです。` });
    else seen.set(key, index);
  });
  return { ok: errors.length === 0, errors, warnings };
}

/** 検証の誤りを1つの文にする（「2件目: 団体名を…」） */
export function describeGroupIssues(issues: readonly GroupValidationIssue[], max = 5): string {
  const lines = issues.slice(0, max).map((i) => (i.index >= 0 ? `${i.index + 1}件目: ${i.message}` : i.message));
  if (issues.length > max) lines.push(`ほか ${issues.length - max} 件`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 状態（§6）
// ---------------------------------------------------------------------------

/** 取引先に見せる状態名 */
export const GROUP_STATUS_LABELS_PARTNER: Record<GroupInquiryStatus, string> = {
  submitted: '回答待ち',
  offered: '回答あり',
  declined: '受けられません',
  accepted: '予約確定',
  rejected: '辞退しました',
  withdrawn: '取り下げました',
  expired: '期限切れ'
};

/** 宿（管理画面）に見せる状態名 */
export const GROUP_STATUS_LABELS_STAFF: Record<GroupInquiryStatus, string> = {
  submitted: '新着（回答待ち）',
  offered: '回答済み・承諾待ち',
  declined: '受けられない',
  accepted: '予約確定',
  rejected: '辞退',
  withdrawn: '取り下げ',
  expired: '期限切れ'
};

export const GROUP_ANSWER_LABELS: Record<GroupAnswer, string> = {
  ok: '受けられます',
  conditional: '条件付きで受けられます',
  declined: '受けられません'
};

export const groupStatusLabel = (status: GroupInquiryStatus, audience: 'partner' | 'staff' = 'partner') =>
  (audience === 'staff' ? GROUP_STATUS_LABELS_STAFF : GROUP_STATUS_LABELS_PARTNER)[status] ?? status;

/** 取引先ページの一覧のタブ（回答待ち／回答あり／予約確定／終了） */
export type GroupStatusTab = 'waiting' | 'answered' | 'booked' | 'closed';
export const GROUP_STATUS_TABS: { id: GroupStatusTab; label: string; statuses: GroupInquiryStatus[] }[] = [
  { id: 'waiting', label: '回答待ち', statuses: ['submitted'] },
  { id: 'answered', label: '回答あり', statuses: ['offered'] },
  { id: 'booked', label: '予約確定', statuses: ['accepted'] },
  { id: 'closed', label: '終了', statuses: ['declined', 'rejected', 'withdrawn', 'expired'] }
];
export const groupStatusTab = (status: GroupInquiryStatus): GroupStatusTab =>
  GROUP_STATUS_TABS.find((t) => t.statuses.includes(status))?.id ?? 'closed';

type StatusRow = { status: GroupInquiryStatus; answer?: GroupAnswer | null; answer_expires_at?: string | null; booking_id?: string | null };

const notExpired = (r: StatusRow, now: Date) => !r.answer_expires_at || new Date(r.answer_expires_at).getTime() > now.getTime();

/** 取引先が承諾できるか（回答あり・受けられる／条件付き・期限内・予約が未作成） */
export const canAccept = (r: StatusRow, now = new Date()) =>
  r.status === 'offered' && (r.answer === 'ok' || r.answer === 'conditional') && !r.booking_id && notExpired(r, now);

/** 取引先が辞退できるか（回答あり） */
export const canReject = (r: StatusRow) => r.status === 'offered';

/** 取引先が取り下げられるか（回答待ち・回答あり）。本人かマスタかはサーバで別に確かめる（canWithdrawBy） */
export const canWithdraw = (r: StatusRow) => r.status === 'submitted' || r.status === 'offered';

/** 取り下げられる人: 送信したアカウント本人かマスタ（§7.9） */
export const canWithdrawBy = (r: StatusRow & { account_id?: string | null }, viewer: { id: string; is_master?: boolean }) =>
  canWithdraw(r) && (viewer.is_master === true || (!!r.account_id && r.account_id === viewer.id));

/** 宿が回答（修正）できるか（新着・回答済み。承諾済み・終了は不可） */
export const canAnswer = (r: StatusRow) => r.status === 'submitted' || r.status === 'offered';

/** 期限切れにする対象か（cron） */
export const isAnswerExpired = (r: StatusRow, now = new Date()) => r.status === 'offered' && !!r.answer_expires_at && !notExpired(r, now);

// ---------------------------------------------------------------------------
// 料金（§7.1・§7.2）
// ---------------------------------------------------------------------------

/** 自動計算の文言（取引先向け） */
export const GROUP_QUOTE_STATUS_TEXT: Record<GroupQuoteStatus, string> = {
  ok: '',
  no_rate: '料金は宿からの回答でご案内します',
  closed: '休館日が含まれます。宿にご確認ください',
  capacity: '1室の人数がお部屋の定員を超えています',
  error: '料金は宿からの回答でご案内します'
};

/** 見積が ok:false のときの文言から、照会の quote_status を決める（quotePartnerBooking の文言に合わせる） */
export function groupQuoteStatusOf(message: string): Exclude<GroupQuoteStatus, 'ok'> {
  if (message.includes('休館日')) return 'closed';
  if (message.includes('定員')) return 'capacity';
  if (message.includes('料金がありません') || message.includes('ご案内できません') || message.includes('人数が正しくありません')) return 'no_rate';
  return 'error';
}

/** 宿泊料金（税込・入湯税別）＝ Σ部屋 Σ泊 1名単価 × 人数 */
export const groupRoomsTotal = (rooms: readonly GroupPriceRoom[]) =>
  rooms.reduce((s, r) => s + r.nights.reduce((t, n) => t + n.unit_price, 0) * r.adults, 0);

/** 部屋ごとの小計を付け直す */
export const withSubtotals = (rooms: readonly GroupPriceRoom[]): GroupPriceRoom[] =>
  rooms.map((r) => ({ adults: r.adults, nights: r.nights.map((n) => ({ date: n.date, unit_price: n.unit_price })), subtotal: r.nights.reduce((t, n) => t + n.unit_price, 0) * r.adults }));

/** 照会の日程（チェックイン日から泊数ぶんの日付） */
export const groupNightDates = (checkIn: string, nights: number) => Array.from({ length: Math.max(0, nights) }, (_, i) => addDays(checkIn, i));

/**
 * 回答の料金（方法1）: 人数の段ごとの1名単価で上書きする（例: 2名1室 22,000 → 20,000）。
 * unitByAdults に無い段は、base（自動計算の部屋）の単価をそのまま使う。base も無い（料金なし）段があれば null。
 */
export function overrideUnitPrices(
  rooms: readonly { adults: number }[],
  dates: readonly string[],
  unitByAdults: Record<string, number>,
  base?: readonly GroupPriceRoom[] | null
): GroupPriceRoom[] | null {
  const out: GroupPriceRoom[] = [];
  for (let i = 0; i < rooms.length; i += 1) {
    const adults = rooms[i].adults;
    const unit = Math.round(Number(unitByAdults[String(adults)]));
    const nights: { date: string; unit_price: number }[] = [];
    for (const date of dates) {
      if (Number.isFinite(unit) && unit >= 1) nights.push({ date, unit_price: unit });
      else {
        const b = base?.[i]?.nights.find((n) => n.date === date)?.unit_price;
        if (!(b != null && b >= 1)) return null;
        nights.push({ date, unit_price: b });
      }
    }
    out.push({ adults, nights });
  }
  return withSubtotals(out);
}

/**
 * 回答の料金（方法2）: 合計（宿泊料金）を直接入れる → 人泊で均等に割って1円未満を切り捨て、端数は最初の部屋の最初の泊に寄せる。
 * PMS の明細（単価 × 人数）の合計が入力の合計と一致するように、端数は「最初の部屋の人数」で割り切れる分だけ寄せ、
 * 割り切れない残り（人数未満の円）は切り捨てる（返り値の total が実際の合計）。
 */
export function spreadTotalOverRooms(
  rooms: readonly { adults: number }[],
  dates: readonly string[],
  total: number
): { rooms: GroupPriceRoom[]; total: number } | null {
  const personNights = rooms.reduce((s, r) => s + r.adults, 0) * dates.length;
  const t = Math.floor(Number(total));
  if (!personNights || !Number.isFinite(t) || t < personNights) return null;
  const unit = Math.floor(t / personNights);
  const rest = t - unit * personNights;
  const firstAdults = rooms[0]?.adults ?? 1;
  const bump = Math.floor(rest / firstAdults);
  const priced: GroupPriceRoom[] = rooms.map((r, i) => ({
    adults: r.adults,
    nights: dates.map((date, j) => ({ date, unit_price: unit + (i === 0 && j === 0 ? bump : 0) }))
  }));
  const out = withSubtotals(priced);
  return { rooms: out, total: groupRoomsTotal(out) };
}

/** 料金の部屋の形が照会と合っているか（部屋数・人数・泊の日付・単価が1円以上） */
export function isValidPriceRooms(priced: readonly GroupPriceRoom[] | null | undefined, rooms: readonly { adults: number }[], dates: readonly string[]): boolean {
  if (!priced || priced.length !== rooms.length) return false;
  return priced.every(
    (r, i) =>
      r.adults === rooms[i].adults &&
      r.nights.length === dates.length &&
      dates.every((d) => r.nights.some((n) => n.date === d && Number.isInteger(n.unit_price) && n.unit_price >= 1))
  );
}

/**
 * 回答の料金の上限の検証（DB の integer に収める・入力ミスの桁違いを止める）。超えていれば文言、問題なければ null。
 *   1名1泊の単価 ≤ GROUP_MAX_UNIT_PRICE・宿泊料金の合計 < GROUP_MAX_TOTAL_EXCLUSIVE
 */
export function groupPriceLimitError(rooms: readonly GroupPriceRoom[] | null | undefined): string | null {
  if (!rooms) return null;
  if (rooms.some((r) => r.nights.some((n) => !Number.isFinite(n.unit_price) || n.unit_price > GROUP_MAX_UNIT_PRICE))) {
    return `1名1泊あたりの料金は ${GROUP_MAX_UNIT_PRICE.toLocaleString('ja-JP')} 円以下で入力してください。`;
  }
  const total = groupRoomsTotal(rooms);
  if (!Number.isFinite(total) || total >= GROUP_MAX_TOTAL_EXCLUSIVE) {
    return `合計（宿泊料金）は ${GROUP_MAX_TOTAL_EXCLUSIVE.toLocaleString('ja-JP')} 円未満にしてください。`;
  }
  return null;
}

/** 人数の段ごとの1名単価（自動計算の部屋から。泊で違う単価なら最初の泊の値・表示の初期値用） */
export function unitPricesByAdults(rooms: readonly GroupPriceRoom[] | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rooms ?? []) {
    const first = r.nights[0]?.unit_price;
    if (first != null && out[String(r.adults)] == null) out[String(r.adults)] = first;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 回答の有効期限
// ---------------------------------------------------------------------------

/** 回答の有効期限の既定（今から groupAnswerDays 日後の 23:59 JST）。チェックイン日の前日を超えない */
export function defaultAnswerExpiry(now: Date, answerDays: number, checkIn: string): Date {
  const todayJst = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  let day = addDays(todayJst, Math.max(1, answerDays));
  const limit = addDays(checkIn, -1);
  if (day > limit) day = limit < todayJst ? todayJst : limit;
  return endOfDayJst(day);
}

/** YYYY-MM-DD の 23:59:59 JST */
export const endOfDayJst = (day: string) => new Date(Date.parse(`${day}T23:59:59Z`) - 9 * 3600 * 1000);

// ---------------------------------------------------------------------------
// 表示（メール・一覧・PMS の要望）
// ---------------------------------------------------------------------------

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
/** 「4/15（水）」 */
export function shortDateJa(iso: string): string {
  if (!ISO_DATE.test(iso)) return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK[d.getUTCDay()]}）`;
}

/** 「4/15（水）〜1泊」 */
export const describeGroupStay = (checkIn: string, nights: number) => `${shortDateJa(checkIn)}〜${nights}泊`;

/** 部屋ごとの人数の表示（「2名×5室」「3名×1室・2名×4室」） */
export function describeRoomAdults(rooms: readonly { adults: number }[]): string {
  const counts = new Map<number, number>();
  for (const r of rooms) counts.set(r.adults, (counts.get(r.adults) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([adults, n]) => `${adults}名×${n}室`)
    .join('・');
}

/** 予約者の1行（describeBooker と同じ） */
export const describeGroupBooker = (b: PartnerBooker | null | undefined) => (b ? describeBooker(normalizeBooker(b)) : '');

// アクセスログ（rms_partner_access_logs.action の group_inquiry_*）の表示名は lib/partner-login-security.ts の LOGIN_LOG_LABELS に置いた（§9.3）

/** やりとり（events.kind）の表示名 */
export const GROUP_EVENT_LABELS: Record<string, string> = {
  submitted: '照会を送信',
  answered: '宿が回答',
  accepted: '承諾（予約確定）',
  accept_failed: '承諾できませんでした',
  rejected: '辞退',
  withdrawn: '取り下げ',
  expired: '回答の期限切れ',
  note: 'メモ'
};
