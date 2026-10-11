// 特別会員の専用ページ（rms_partners.kind='member'・docs/vip-member-page.md §13・§14）の純関数と型。
// サーバ（/p/[token] の member 版・公式の予約確認・マイページ・管理画面）と画面（B）の両方から使う。
//
//   - 見せ方は取引先ページ、予約は会員の公式予約（束 hold_groups → bookings ＋ 部屋のお金 booking_rooms）
//   - 束のもの（どの専用ページ経由か・キャンセル方式と規定）は bookings.metadata.member_page（MemberPageSnapshot）
//   - 部屋のもの（そのプランに付く専用特典）は booking_rooms.member_perks（MemberPerkSnapshot[]）
import { MAX_ROOMS_PER_BOOKING, payCompatible } from './multi-room';
import type { PartnerPerk } from './partner-booking';

/** 種別が特別会員か（アンバサダー ambassador は今回 TS に出さない・§13.8 Q7） */
export const isMemberPage = (kind: string | null | undefined): boolean => kind === 'member';

/** 取引先ページの表示名（PARTNER_KIND_LABELS と同じ） */
export const MEMBER_PAGE_KIND_LABEL = '特別会員';

/**
 * 専用ページで予約できるか（取引先の isPartnerBookingOpen は支払方法を見るが、特別会員は公式予約の支払方法なので見ない・Z12）。
 * booking_enabled / facility_available は選んでいる施設で合成した値
 */
export function memberPageBookingOpen(partner: { kind: string; booking_enabled: boolean; facility_available: boolean }): boolean {
  return isMemberPage(partner.kind) && partner.booking_enabled && partner.facility_available;
}

/** 専用ページの 1 回の予約の室数の上限（公式と同じ 4 室まで。取引先の最大室数が 5 以上でも 4・Q2） */
export const memberMaxRooms = (s: { maxRooms: number }): number =>
  Math.max(1, Math.min(MAX_ROOMS_PER_BOOKING, Math.round(Number(s.maxRooms)) || 1));

// ---- キャンセル方式（§6.3・D1） ----

export type CancelPolicyMode = 'favorable' | 'page' | 'rank';
export const CANCEL_POLICY_MODES: readonly CancelPolicyMode[] = ['favorable', 'page', 'rank'];
export const DEFAULT_CANCEL_POLICY_MODE: CancelPolicyMode = 'favorable';
export const CANCEL_POLICY_LABELS: Record<CancelPolicyMode, string> = {
  favorable: 'お客さまに有利な方',
  page: '専用ページの規定',
  rank: '会員グレードの規定'
};
/** 方式の説明（管理画面のラジオの下・会員特典の 2 段目） */
export const CANCEL_POLICY_NOTES: Record<CancelPolicyMode, string> = {
  favorable: '専用ページの規定と会員グレードの規定（プランの規定があればそれ）を両方計算し、キャンセル料の安い方（専用ページの規定に当てはまる段が無い日はキャンセル料なしとして比べる）',
  page: '専用ページの規定（設定が無ければ公式と同じ: プランの規定 → 会員グレードの規定）',
  rank: '公式サイトと同じ（プランの規定 → 会員グレードの規定）'
};

export const normalizeCancelPolicyMode = (raw: unknown): CancelPolicyMode =>
  CANCEL_POLICY_MODES.includes(raw as CancelPolicyMode) ? (raw as CancelPolicyMode) : DEFAULT_CANCEL_POLICY_MODE;

/** 専用ページの規定の 1 段（book.rank_cancel_policies.rules と同じ形・rate は 0〜1） */
export type MemberCancelRule = { days_before: number; rate: number };
export const MAX_MEMBER_CANCEL_RULES = 10;

/**
 * 規定の表を正規化する: days_before は 0〜365 の整数・rate は 0〜1（小数 3 桁まで）・同じ日数は後の段を採る・日数の多い順・10 段まで。
 * 配列でなければ空（＝専用ページの規定なし）
 */
export function normalizeCancelRules(raw: unknown): MemberCancelRule[] {
  if (!Array.isArray(raw)) return [];
  const byDays = new Map<number, number>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const days = Math.round(Number(o.days_before));
    const rate = Number(o.rate);
    if (!Number.isFinite(days) || days < 0 || days > 365 || !Number.isFinite(rate) || rate < 0 || rate > 1) continue;
    byDays.set(days, Math.round(rate * 1000) / 1000);
  }
  return [...byDays.entries()]
    .map(([days_before, rate]) => ({ days_before, rate }))
    .sort((a, b) => b.days_before - a.days_before)
    .slice(0, MAX_MEMBER_CANCEL_RULES);
}

/** 取引先の規定の形（rate_percent・partner-plan-terms の Rule）→ 専用ページの規定（rate 0〜1） */
export const toCancelRules = (rules: readonly { days_before: number; rate_percent: number }[]): MemberCancelRule[] =>
  normalizeCancelRules(rules.map((r) => ({ days_before: r.days_before, rate: Number(r.rate_percent) / 100 })));

/** 専用ページの規定 → 画面の表（率 %） */
export const fromCancelRules = (rules: readonly MemberCancelRule[]): { days_before: number; rate_percent: number }[] =>
  normalizeCancelRules(rules).map((r) => ({ days_before: r.days_before, rate_percent: Math.round(r.rate * 1000) / 10 }));

/** 規定の 1 段の文言（「7日前から 10%」・0 日前は「当日」） */
export function describeCancelRule(r: MemberCancelRule): string {
  const when = r.days_before === 0 ? '当日' : r.days_before === 1 ? '前日から' : `${r.days_before}日前から`;
  return `${when} ${Math.round(r.rate * 1000) / 10}%`;
}

// ---- 会員特典の 2 段目（Q8: 還元率・キャンセル方式・ポイント利用可の 3 行） ----

/** グレードのラベル（book.member_ranks.label が無いときの既定） */
export const MEMBER_RANK_LABELS: Record<string, string> = {
  standard: 'STANDARD',
  silver: 'SILVER',
  gold: 'GOLD',
  platinum: 'PLATINUM'
};
export const rankLabelOf = (code: string | null | undefined, label?: string | null): string =>
  (label && label.trim()) || MEMBER_RANK_LABELS[String(code ?? '')] || String(code ?? '').toUpperCase() || 'STANDARD';

/** 還元率（0.03 → 「3%」。0.015 → 「1.5%」） */
export const rewardPercentText = (rate: number): string => `${Math.round((Number(rate) || 0) * 1000) / 10}%`;

export function memberBenefitLines(rankLabel: string, rewardRate: number, cancelMode: CancelPolicyMode): string[] {
  return [
    `ご宿泊料金（専用料金）の ${rewardPercentText(rewardRate)} をポイントで還元（${rankLabel}）`,
    `キャンセル料: ${CANCEL_POLICY_LABELS[cancelMode]}（${CANCEL_POLICY_NOTES[cancelMode]}）`,
    'お持ちのポイント・会員クーポンをご予約に使えます'
  ];
}

/** 獲得予定ポイントの目安（DB の付与見込みと同じ式: floor(支払額 ÷ 1.10 × 還元率)。ポイント利用・割引は考えない） */
export const earnEstimateOf = (charge: number, rewardRate: number): number =>
  Math.max(0, Math.floor((Math.max(0, Math.round(charge)) / 1.1) * (Number(rewardRate) || 0)));

// ---- 束と部屋の写し（DB の jsonb → 画面の型） ----

/** 束（bookings.metadata.member_page / hold_groups.metadata.member_page）。DB は snake_case */
export type MemberPageSnapshot = {
  partnerId: string;
  facilityId: string | null;
  memberUserId: string | null;
  pageName: string;
  via: 'self' | 'family';
  cancelPolicyMode: CancelPolicyMode;
  cancelRules: MemberCancelRule[];
};

/** 部屋の専用特典の写し（booking_rooms.member_perks / holds.member_perks の要素） */
export type MemberPerkSnapshot = { id: string | null; title: string; description: string };

const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function parseMemberPageSnapshot(raw: unknown): MemberPageSnapshot | null {
  const o = asObj(raw);
  if (!o || typeof o.partner_id !== 'string' || !o.partner_id) return null;
  return {
    partnerId: o.partner_id,
    facilityId: typeof o.facility_id === 'string' ? o.facility_id : null,
    memberUserId: typeof o.member_user_id === 'string' ? o.member_user_id : null,
    pageName: typeof o.page_name === 'string' ? o.page_name : '',
    via: o.via === 'family' ? 'family' : 'self',
    cancelPolicyMode: normalizeCancelPolicyMode(o.cancel_policy_mode),
    cancelRules: normalizeCancelRules(o.cancel_rules)
  };
}

export function parseMemberPerks(raw: unknown): MemberPerkSnapshot[] | null {
  if (!Array.isArray(raw)) return null;
  const out = raw
    .map(asObj)
    .filter((o): o is Record<string, unknown> => !!o && typeof o.title === 'string' && o.title.trim() !== '')
    .map((o) => ({
      id: typeof o.id === 'string' && o.id ? o.id : null,
      title: String(o.title).trim(),
      description: typeof o.description === 'string' ? o.description : ''
    }));
  return out.length ? out : null;
}

/** 仮押さえ（RPC）に渡す特典の写し: このプランに付く特典だけ（perksForPlan と同じ規則）。無ければ null */
export function perksSnapshotOf(perks: readonly Pick<PartnerPerk, 'id' | 'title' | 'description' | 'planCodes'>[], planCode: string): { id: string; title: string; description: string }[] | null {
  const list = perks
    .filter((p) => !p.planCodes.length || p.planCodes.includes(planCode))
    .filter((p) => p.title.trim())
    .map((p) => ({ id: p.id, title: p.title.trim(), description: p.description }));
  return list.length ? list : null;
}

/** RPC の member_page（束のもの）。partner_id / facility_id / member_user_id / via は DB が決める */
export function memberPageInput(pageName: string, mode: CancelPolicyMode, rules: readonly MemberCancelRule[]) {
  return {
    page_name: pageName,
    cancel_policy_mode: mode,
    // 「会員グレードの規定」では専用ページの規定を写さない（使わないため）
    cancel_rules: mode === 'rank' ? [] : normalizeCancelRules(rules)
  };
}

// ---- 予約の 1 室（専用ページの ?/hold・かご）と泊明細 ----

/** 専用ページの仮押さえの 1 室（取引先の識別子: PMS の部屋タイプのコード・料金カレンダーのプランのコードと名前） */
export type MemberHoldRoom = { roomCode: string; planCode: string; planName: string; adults: number };

export type ParseMemberHoldRoomsResult =
  | { ok: true; rooms: MemberHoldRoom[] }
  | { ok: false; code: 'missing' | 'too_many_rooms' | 'invalid' };

const CODE_RE = /^[A-Za-z0-9_.-]{1,40}$/;

/**
 * 専用ページの「予約へ進む」のフォームから部屋の並びを読む。
 *   rooms … JSON `[{roomCode, planCode, planName, adults}]`（1〜maxRooms 室・かご）
 *   無ければ 1 タップのフィールド room / plan / name / guests / rooms（同じ部屋タイプ × N 室・同じ人数）
 * 大人は 1〜6 名の整数。プラン名は料金カレンダーの名前（照合に使う・120 字まで）
 */
export function parseMemberHoldRooms(get: (key: string) => FormDataEntryValue | null, maxRooms: number): ParseMemberHoldRoomsResult {
  const limit = Math.max(1, Math.min(MAX_ROOMS_PER_BOOKING, Math.round(maxRooms) || 1));
  const raw = get('rooms');
  let items: unknown[];
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const v = JSON.parse(raw);
      if (!Array.isArray(v)) return { ok: false, code: 'invalid' };
      items = v;
    } catch {
      return { ok: false, code: 'invalid' };
    }
  } else {
    const roomCode = get('room');
    const planCode = get('plan');
    if (typeof roomCode !== 'string' || typeof planCode !== 'string' || !roomCode || !planCode) return { ok: false, code: 'missing' };
    const count = Math.round(Number(typeof raw === 'string' && raw.trim() ? raw : 1));
    if (!Number.isInteger(count) || count < 1) return { ok: false, code: 'invalid' };
    if (count > limit) return { ok: false, code: 'too_many_rooms' };
    const planName = String(get('name') ?? '');
    const adults = Number(get('guests'));
    items = Array.from({ length: count }, () => ({ roomCode, planCode, planName, adults }));
  }
  if (items.length === 0) return { ok: false, code: 'missing' };
  if (items.length > limit) return { ok: false, code: 'too_many_rooms' };
  const rooms: MemberHoldRoom[] = [];
  for (const it of items) {
    const o = asObj(it);
    if (!o) return { ok: false, code: 'invalid' };
    const roomCode = String(o.roomCode ?? '').trim();
    const planCode = String(o.planCode ?? '').trim();
    const planName = String(o.planName ?? '').trim();
    const adults = Number(o.adults);
    if (!CODE_RE.test(roomCode) || !CODE_RE.test(planCode) || planName.length > 120) return { ok: false, code: 'invalid' };
    if (!Number.isInteger(adults) || adults < 1 || adults > 6) return { ok: false, code: 'invalid' };
    rooms.push({ roomCode, planCode, planName, adults });
  }
  return { ok: true, rooms };
}

/** 部屋タイプ・プランの組（quotePartnerBooking を呼ぶ単位）にまとめる。並び順は最初に出た順 */
export function groupMemberHoldRooms(rooms: readonly MemberHoldRoom[]): { roomCode: string; planCode: string; planName: string; indexes: number[] }[] {
  const out: { roomCode: string; planCode: string; planName: string; indexes: number[] }[] = [];
  rooms.forEach((r, i) => {
    const g = out.find((x) => x.roomCode === r.roomCode && x.planCode === r.planCode && x.planName === r.planName);
    if (g) g.indexes.push(i);
    else out.push({ roomCode: r.roomCode, planCode: r.planCode, planName: r.planName, indexes: [i] });
  });
  return out;
}

/** 専用料金の泊明細（RPC の lines・DB の price_lines と同じ形） */
export type MemberLine = { date: string; unit_price: number; adults: number; subtotal: number };

/** quotePartnerBooking の rooms[i]（{adults, nights:[{date, unit_price}]}）→ RPC に渡す lines（仮押さえと日程変更で共用） */
export function toHoldLines(room: { adults: number; nights: readonly { date: string; unit_price: number }[] }): MemberLine[] {
  return room.nights.map((n) => ({ date: n.date, unit_price: n.unit_price, adults: room.adults, subtotal: n.unit_price * room.adults }));
}

/** 日程変更の RPC に渡す生きている部屋ごとの泊明細 */
export type MemberAmendRoomLines = { room_index: number; lines: MemberLine[] };

// ---- ご予約一覧・リンク ----

/** このページから本人が予約した分だけ（家族の予約・公式・別ページの予約は出さない・Q10） */
export function memberPageBookingsOf<T extends { memberPage?: Pick<MemberPageSnapshot, 'partnerId' | 'memberUserId'> | null }>(
  reservations: readonly T[],
  partnerId: string,
  memberUserId: string
): T[] {
  return reservations.filter((r) => r.memberPage?.partnerId === partnerId && (!r.memberPage.memberUserId || r.memberPage.memberUserId === memberUserId));
}

/** 専用ページの予約詳細の URL（確認メール・マイページ・非会員リンクの案内と同じ形） */
export const memberPageHrefOf = (token: string, code: string): string => `/p/${encodeURIComponent(token)}/bookings/${encodeURIComponent(code)}`;

/** 専用ページの料金カレンダーの URL（マイページのリンク） */
export const memberPageCalendarHrefOf = (token: string): string => `/p/${encodeURIComponent(token)}/calendar`;

// ---- かご（専用ページ・sessionStorage・公式のかごとは別のキー） ----

/** 専用ページのかごの 1 室。roomTypeId には PMS の部屋タイプのコード（roomCode と同じ値）を入れる（multi-room の判定を共用するため） */
export type MemberCartItem = {
  key: string;
  partnerToken: string;
  facilityId: string;
  facilitySlug: string;
  checkin: string;
  nights: number;
  roomCode: string;
  /** = roomCode（canAddToCart の同じ部屋タイプの判定に使う） */
  roomTypeId: string;
  roomName: string;
  planCode: string;
  planName: string;
  /** 専用ページでのプラン名（planNames の上書き・表示用） */
  displayName: string;
  adults: number;
  /** その部屋の専用料金（全泊・表示用。確定はサーバが計算し直す） */
  total: number;
  pay: { onsite: boolean; prepay: boolean };
  remaining: number | null;
};

export const MEMBER_CART_STORAGE_KEY = 'ab_member_cart_v1';

/** かごの部屋を送る形（?/hold の rooms JSON） */
export const memberCartPayload = (cart: readonly Pick<MemberCartItem, 'roomCode' | 'planCode' | 'planName' | 'adults'>[]): MemberHoldRoom[] =>
  cart.map((c) => ({ roomCode: c.roomCode, planCode: c.planCode, planName: c.planName, adults: c.adults }));

/** かごの部屋がすべて同じ支払方法で払えるか（公式と同じ・Q3） */
export const memberCartPayCompatible = (cart: readonly Pick<MemberCartItem, 'pay'>[]): boolean => payCompatible(cart.map((c) => c.pay));

export function isMemberCartItem(v: unknown): v is MemberCartItem {
  const o = asObj(v);
  return (
    !!o &&
    typeof o.key === 'string' &&
    typeof o.partnerToken === 'string' &&
    typeof o.facilityId === 'string' &&
    typeof o.checkin === 'string' &&
    Number.isInteger(o.nights) &&
    typeof o.roomCode === 'string' &&
    typeof o.planCode === 'string' &&
    typeof o.planName === 'string' &&
    Number.isInteger(o.adults) &&
    typeof o.total === 'number' &&
    !!asObj(o.pay)
  );
}

/** 読んだ値を整える（roomTypeId は roomCode にそろえる） */
export const normalizeMemberCartItem = (c: MemberCartItem): MemberCartItem => ({
  ...c,
  roomTypeId: c.roomCode,
  facilitySlug: String(c.facilitySlug ?? ''),
  roomName: String(c.roomName ?? ''),
  displayName: String(c.displayName ?? c.planName ?? ''),
  pay: { onsite: c.pay.onsite === true, prepay: c.pay.prepay === true },
  remaining: typeof c.remaining === 'number' ? c.remaining : null
});

// ---- 専用ページの操作（取消・日程変更・オプション）の DB の例外 → 画面のコードと文言 ----

export type MemberPageOpError = { code: string; message: string; status: number };

/**
 * DB の例外の語（例外の文の中の英小文字と _ のかたまり。sold_out:<id> は sold_out）で判定する。
 * 判定は具体的な語から順に（room_not_found が not_found に、option_sold_out が sold_out に先に当たらないように・2026-10-11 レビュー指摘 3）
 */
const MEMBER_PAGE_OP_ERRORS: [string, MemberPageOpError][] = [
  ['not_member_page_booking', { code: 'not_found', status: 404, message: 'ご予約が見つかりません。' }],
  ['room_not_found', { code: 'invalid', status: 400, message: 'お部屋を選び直してください。' }],
  ['option_sold_out', { code: 'option_sold_out', status: 409, message: 'アレンジの在庫がありません。' }],
  ['invalid_service_date', { code: 'option_failed', status: 400, message: 'アレンジのご利用日を選び直してください。' }],
  ['invalid_quantity', { code: 'option_failed', status: 400, message: 'アレンジの数量を確かめてください。' }],
  ['invalid_lines', { code: 'invalid', status: 400, message: '料金を確かめられませんでした。画面を読み直してください。' }],
  ['member_page_booking', { code: 'forbidden', status: 403, message: 'このご予約はお手続きいただけません。' }],
  ['amend_in_penalty', { code: 'in_penalty', status: 400, message: 'キャンセル料がかかる期間のため、日程を変更できません。お電話でお問い合わせください。' }],
  ['prepaid_online', { code: 'prepaid_online', status: 400, message: 'オンライン決済済みのご予約は日程を変更できません。お電話でお問い合わせください。' }],
  ['amend_limit', { code: 'amend_limit', status: 400, message: '日程の変更は2回までです。' }],
  ['past_deadline', { code: 'deadline_passed', status: 400, message: '受付期限を過ぎています。お電話でお問い合わせください。' }],
  ['no_change', { code: 'no_change', status: 400, message: '日程が変わっていません。' }],
  ['past_checkin', { code: 'invalid', status: 400, message: '過去の日付には変更できません。' }],
  ['sold_out', { code: 'sold_out', status: 409, message: '全室のお部屋を確保できません。別の日程をお試しください。' }],
  ['not_amendable', { code: 'not_allowed', status: 400, message: 'このご予約は現在お手続きできません。' }],
  ['not_cancellable', { code: 'not_allowed', status: 400, message: 'このご予約は現在お手続きできません。' }],
  ['forbidden', { code: 'forbidden', status: 403, message: 'このご予約はお手続きいただけません（ご予約された会員さまのログインでお手続きください）。' }],
  ['not_found', { code: 'not_found', status: 404, message: 'ご予約が見つかりません。' }]
];

export function memberPageOpError(e: unknown): MemberPageOpError {
  const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message ?? '') : String(e ?? '');
  const words = new Set(msg.match(/[a-z_]+/g) ?? []);
  for (const [key, err] of MEMBER_PAGE_OP_ERRORS) if (words.has(key)) return { ...err };
  return { code: 'error', status: 500, message: 'お手続きできませんでした。時間をおいてお試しください。' };
}
