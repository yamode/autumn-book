// プライベートブック（特別会員を公式サイト＝A面の中で扱う・docs/private-book.md）のサーバ側。
//
//   状態:   クッキー ab_private_book（partnerId だけ）。クッキーは信じず、resolvePrivateBook がリクエストのたびに
//           会員ログイン・使えるページ（rms_member_pages_for）・rms_member_page_access・kind='member'・公開期間を確かめる。
//           hooks で locals.privateBook に 1 回だけ入れる。通らなければクッキーを消す。
//   料金:   施設ごと。その施設で専用ページの予約受付がオンで、販売中の料金ルールがあれば特別料金（pbFacilitySpecial）。
//           特別料金は専用ページの料金ルール（loadPartnerRates・RMS の取引先料金）の泊ごとの1名料金 × 人数の和。
//           A面は ID（rate_plan / room_type の UUID）、料金カレンダーはコード（planCode■planName・PMS の部屋コード）なので、
//           対応は loadMemberPagePlans（book.member_page_plans）と pms.room_types で取る。
//   仮押さえ: プラン詳細の ?/hold で privateBookHold。状態と料金をここでやり直し（画面の金額は受け取らない）、
//           特別会員の束（createMemberPageHoldCore → book.create_member_page_hold_group）を作る。RPC も対象者を確かめる。
//
// service_role（partnerServiceClient）を使う。取引先モジュールと同じく、入口（resolvePrivateBook）で本人と
// ページの結び付きを確かめてから読む（admin-client.ts の例外その6）。
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dev } from '$app/environment';
import { DATA_SOURCE } from '$lib/server/supabase';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { loadPartnerContextAt, memberPageAccess, memberPagesFor, todayJst, addDaysIso, type PartnerContext } from '$lib/server/partners/store';
import { clampPartnerRange, loadPartnerRates, PARTNER_MAX_RANGE_DAYS } from '$lib/server/partners/rates';
import { roomTypeRemaining } from '$lib/server/partners/booking';
import { createMemberPageHoldCore, loadMemberPagePlans, quoteMemberRooms, type MemberHoldResult, type MemberPagePlan } from '$lib/server/partners/member-hold';
import { canBookFor } from '$lib/partner-booking';
import type { MemberHoldRoom } from '$lib/partner-member-page';
import {
  PB_COOKIE,
  parsePbCookie,
  pbFacilitySpecial,
  pbPerPerson,
  pbStayCalendarDays,
  pbStayQuotes,
  privateBookVerdict,
  type PbCalendarDay,
  type PbOffer,
  type PbPartnerGate,
  type PbRateDay,
  type PrivateBookState
} from '$lib/private-book';

// ---------------------------------------------------------------------------
// 状態（クッキー）
// ---------------------------------------------------------------------------

/** 状態のクッキーを書く（セッション限り＝maxAge なし・httpOnly・path=/） */
export function setPrivateBookCookie(cookies: Cookies, partnerId: string): void {
  cookies.set(PB_COOKIE, partnerId, { path: '/', httpOnly: true, sameSite: 'lax', secure: !dev });
}

export function clearPrivateBookCookie(cookies: Cookies): void {
  cookies.delete(PB_COOKIE, { path: '/' });
}

function service(): SupabaseClient | null {
  return DATA_SOURCE === 'supabase' ? partnerServiceClient() : null;
}

async function partnerGate(sb: SupabaseClient, partnerId: string): Promise<PbPartnerGate | null> {
  const { data, error } = await sb.from('rms_partners').select('kind, is_active, valid_from, valid_until').eq('id', partnerId).maybeSingle();
  if (error) throw new Error(error.message);
  const r = data as Record<string, unknown> | null;
  if (!r) return null;
  return {
    kind: String(r.kind ?? ''),
    is_active: r.is_active === true,
    valid_from: typeof r.valid_from === 'string' ? r.valid_from : null,
    valid_until: typeof r.valid_until === 'string' ? r.valid_until : null
  };
}

/**
 * 会員 userId がページ partnerId を今使えるかを確かめて状態を返す（クッキーを使わない版・入口と hold で使う）。
 * 使えなければ null。読めないときは例外
 */
export async function verifyPrivateBook(userId: string, partnerId: string): Promise<PrivateBookState | null> {
  const sb = service();
  if (!sb) return null;
  const id = parsePbCookie(partnerId);
  if (!id) return null;
  const [pages, access, partner] = await Promise.all([memberPagesFor(sb, userId), memberPageAccess(sb, id, userId), partnerGate(sb, id)]);
  return privateBookVerdict({ cookie: id, isMember: true, pages, access, partner, today: todayJst() });
}

/**
 * リクエストの状態（hooks で 1 回）。クッキーが無ければ null（DB を読まない）。
 * 会員でない・ページを使えない・kind が違う・公開期間の外ならクッキーを消して null。
 * DB が読めないときは、このリクエストだけ null（クッキーは残す）
 */
export async function resolvePrivateBook(event: Pick<RequestEvent, 'cookies' | 'locals'>): Promise<PrivateBookState | null> {
  const raw = event.cookies.get(PB_COOKIE);
  if (!raw) return null;
  const user = event.locals.user;
  if (user?.role !== 'member' || !parsePbCookie(raw) || !service()) {
    clearPrivateBookCookie(event.cookies);
    return null;
  }
  try {
    const state = await verifyPrivateBook(user.id, raw);
    if (!state) clearPrivateBookCookie(event.cookies);
    return state;
  } catch (e) {
    console.error('[private-book] 状態を確かめられませんでした', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 施設ごと
// ---------------------------------------------------------------------------

export type PbFacility = { ctx: PartnerContext; special: boolean };

/** 状態のときの、その施設の専用ページ（特別料金で出すか）。状態でない・施設の行が無い・読めないときは null */
export async function privateBookFacility(state: PrivateBookState | null | undefined, facilityId: string): Promise<PbFacility | null> {
  const sb = service();
  if (!state || !sb) return null;
  try {
    const ctx = await loadPartnerContextAt(sb, state.partnerId, facilityId);
    if (!ctx || ctx.kind !== 'member') return null;
    return { ctx, special: pbFacilitySpecial(ctx, facilityId, todayJst()) };
  } catch (e) {
    console.error('[private-book] 施設の設定を読めませんでした', e instanceof Error ? e.message : e);
    return null;
  }
}

/** 画面に出す施設ごとの表示（状態でなければ null） */
export const pbFacilityView = (state: PrivateBookState | null | undefined, fac: PbFacility | null) =>
  state ? { special: !!fac?.special } : null;

// 部屋タイプのコード ⇄ id（pms.room_types・施設ごとに 60 秒使い回す）。
// 覚えるのは読み終わった値だけ（読み込み途中の Promise を別のリクエストと分け合うと Workers で 500 になる・public-cache.ts の ★）
type RoomCodes = { codeToId: Map<string, string>; idToCode: Map<string, string> };
const ROOM_TTL_MS = 60 * 1000;
const roomCache = new Map<string, { at: number; value: RoomCodes }>();

async function roomTypeCodes(sb: SupabaseClient, facilityId: string): Promise<RoomCodes> {
  const hit = roomCache.get(facilityId);
  if (hit && Date.now() - hit.at < ROOM_TTL_MS) return hit.value;
  const { data, error } = await sb.schema('pms').from('room_types').select('id, code').eq('facility_id', facilityId).eq('is_active', true);
  if (error) throw new Error(error.message);
  const codeToId = new Map<string, string>();
  const idToCode = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; code: string | null }[]) {
    if (!r.code) continue;
    codeToId.set(String(r.code), String(r.id));
    idToCode.set(String(r.id), String(r.code));
  }
  const value = { codeToId, idToCode };
  roomCache.set(facilityId, { at: Date.now(), value });
  return value;
}

/** 専用ページで売るプラン（キー → プラン・id → キー） */
async function planMaps(sb: SupabaseClient, facilityId: string, ratePlanId?: string) {
  const plans = await loadMemberPagePlans(sb, facilityId);
  const keys = new Set<string>();
  const idToPlan = new Map<string, MemberPagePlan>();
  for (const [key, p] of plans) {
    idToPlan.set(p.ratePlanId, p);
    if (!ratePlanId || p.ratePlanId === ratePlanId) keys.add(key);
  }
  return { plans, keys, idToPlan };
}

/** 泊まりの範囲が専用ページで出せるか（泊数の上限・締切・公開範囲） */
function stayAllowed(ctx: PartnerContext, checkIn: string, nights: number): { from: string; to: string } | null {
  const s = ctx.booking_settings;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !(nights >= 1) || nights > s.maxNights || nights > PARTNER_MAX_RANGE_DAYS) return null;
  if (!canBookFor(checkIn, s)) return null;
  const last = addDaysIso(checkIn, nights - 1);
  const range = clampPartnerRange(ctx, checkIn, last);
  return range && range.from === checkIn && range.to === last ? { from: checkIn, to: last } : null;
}

/**
 * 特別料金の「プラン×部屋タイプ×料金×残室」（sbPlanOffers と同じ形）。特別料金の施設でなければ空。
 * 出せない組（料金ルールの外・休館・人数の料金なし・満室）は入れない（その組はふつうの料金のまま出る）。読めなければ空
 */
export async function privateBookOffers(
  fac: PbFacility | null,
  facilityId: string,
  checkIn: string,
  nights: number,
  adults: number,
  opts: { ratePlanId?: string; roomTypeId?: string } = {}
): Promise<PbOffer[]> {
  const sb = service();
  if (!sb || !fac?.special) return [];
  const range = stayAllowed(fac.ctx, checkIn, nights);
  if (!range) return [];
  try {
    const [{ plans, keys }, rooms, rates] = await Promise.all([
      planMaps(sb, facilityId, opts.ratePlanId),
      roomTypeCodes(sb, facilityId),
      loadPartnerRates(sb, fac.ctx, range, { guests: [adults] })
    ]);
    const roomCode = opts.roomTypeId ? rooms.idToCode.get(opts.roomTypeId) : undefined;
    if (opts.roomTypeId && !roomCode) return [];
    const quotes = pbStayQuotes(rates.days as PbRateDay[], checkIn, nights, adults, { plans: keys, roomCodes: roomCode ? new Set([roomCode]) : undefined });
    const codes = [...new Set(quotes.map((q) => q.roomCode))];
    const left = new Map(
      await Promise.all(
        codes.map(async (code) => [code, (await roomTypeRemaining(sb, facilityId, code, checkIn, addDaysIso(range.to, 1))).min] as const)
      )
    );
    const out: PbOffer[] = [];
    for (const q of quotes) {
      const plan = plans.get(q.planKey);
      const roomTypeId = rooms.codeToId.get(q.roomCode);
      const remaining = left.get(q.roomCode) ?? q.remaining;
      if (!plan || !roomTypeId || remaining == null || remaining <= 0) continue;
      out.push({ ratePlanId: plan.ratePlanId, roomTypeId, total: q.total, perPerson: pbPerPerson(q.total, adults, nights), remaining });
    }
    return out;
  } catch (e) {
    console.error('[private-book] 特別料金を読めませんでした', e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * 日付を決めていないときの参考の特別料金（今日から 31 日の中の最安「1名1泊」・プラン×部屋タイプごと）。
 * sbRoomPlanReferencePrices と同じ形。特別料金の施設でなければ空
 */
export async function privateBookReferencePrices(
  fac: PbFacility | null,
  facilityId: string,
  adults: number,
  ratePlanId?: string
): Promise<{ ratePlanId: string; roomTypeId: string; minPerPerson: number }[]> {
  const sb = service();
  if (!sb || !fac?.special) return [];
  const today = todayJst();
  const range = clampPartnerRange(fac.ctx, today, addDaysIso(today, PARTNER_MAX_RANGE_DAYS - 1));
  if (!range) return [];
  try {
    const [{ plans, keys }, rooms, rates] = await Promise.all([
      planMaps(sb, facilityId, ratePlanId),
      roomTypeCodes(sb, facilityId),
      loadPartnerRates(sb, fac.ctx, { from: range.from, to: range.to }, { guests: [adults] })
    ]);
    const s = fac.ctx.booking_settings;
    const min = new Map<string, { ratePlanId: string; roomTypeId: string; minPerPerson: number }>();
    for (const day of rates.days as PbRateDay[]) {
      if (day.closed || !canBookFor(day.date, s)) continue;
      for (const room of day.rooms) {
        const roomTypeId = rooms.codeToId.get(room.roomCode);
        if (!roomTypeId) continue;
        for (const p of room.plans) {
          const key = `${p.planCode}■${p.planName}`;
          const plan = keys.has(key) ? plans.get(key) : undefined;
          const unit = p.pricesPerPerson[String(adults)];
          if (!plan || unit == null) continue;
          const k = `${plan.ratePlanId}|${roomTypeId}`;
          const cur = min.get(k);
          if (!cur || unit < cur.minPerPerson) min.set(k, { ratePlanId: plan.ratePlanId, roomTypeId, minPerPerson: unit });
        }
      }
    }
    return [...min.values()];
  } catch (e) {
    console.error('[private-book] 参考の特別料金を読めませんでした', e instanceof Error ? e.message : e);
    return [];
  }
}

/** プランごとの参考の特別料金の最安（sbPlanReferenceMinPrices と同じ形） */
export async function privateBookPlanReferenceMin(fac: PbFacility | null, facilityId: string, adults: number, ratePlanId?: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const r of await privateBookReferencePrices(fac, facilityId, adults, ratePlanId)) {
    const cur = out.get(r.ratePlanId);
    if (cur == null || r.minPerPerson < cur) out.set(r.ratePlanId, r.minPerPerson);
  }
  return out;
}

/**
 * 特別料金の空室カレンダー（stayCalendar と同じ形の days）。normal（ふつうの空室カレンダー）に重ねる:
 * 特別料金を出せる日はその料金、出せない日（料金ルールの外など）はふつうの料金のまま。特別料金の施設でなければ normal のまま
 */
export async function privateBookStayCalendar(
  fac: PbFacility | null,
  facilityId: string,
  nights: number,
  adults: number,
  normal: { days: PbCalendarDay[]; through: string; closed: string[] },
  opts: { planId?: string; roomTypeId?: string } = {}
): Promise<{ days: PbCalendarDay[]; through: string; closed: string[] }> {
  const sb = service();
  if (!sb || !fac?.special) return normal;
  const s = fac.ctx.booking_settings;
  if (nights > s.maxNights) return normal;
  const today = todayJst();
  const lastCheckIn = normal.through || addDaysIso(today, 60);
  try {
    const [{ keys }, rooms] = await Promise.all([planMaps(sb, facilityId, opts.planId), roomTypeCodes(sb, facilityId)]);
    const roomCode = opts.roomTypeId ? rooms.idToCode.get(opts.roomTypeId) : undefined;
    if (opts.roomTypeId && !roomCode) return normal;
    // 料金カレンダーは 1 回 31 日まで。最後のチェックイン日の泊まで読む（公開範囲で切る）
    const chunks: { from: string; to: string }[] = [];
    let from = today;
    const end = addDaysIso(lastCheckIn, nights - 1);
    for (let i = 0; i < 12 && from <= end; i += 1) {
      const r = clampPartnerRange(fac.ctx, from, addDaysIso(from, PARTNER_MAX_RANGE_DAYS - 1));
      if (!r) break;
      chunks.push({ from: r.from, to: r.to > end ? end : r.to });
      if (r.to >= r.latest) break;
      from = addDaysIso(r.to, 1);
    }
    const days: PbRateDay[] = [];
    // 同時に 2 本まで（料金の幅と同じく DB を取り合わない）
    for (let i = 0; i < chunks.length; i += 2) {
      const part = await Promise.all(chunks.slice(i, i + 2).map((c) => loadPartnerRates(sb, fac.ctx, c, { guests: [adults], rooms: roomCode ? [roomCode] : undefined })));
      for (const p of part) days.push(...(p.days as PbRateDay[]));
    }
    const fallback = new Map(normal.days.map((d) => [d.date, { remaining: d.remaining, rooms: d.rooms }]));
    const special = pbStayCalendarDays(days, { from: today, to: lastCheckIn }, nights, adults, {
      plans: keys,
      roomCodes: roomCode ? new Set([roomCode]) : undefined,
      canBook: (d) => canBookFor(d, s),
      fallback
    });
    const byDate = new Map(normal.days.map((d) => [d.date, d]));
    for (const d of special) byDate.set(d.date, d);
    return { ...normal, days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  } catch (e) {
    console.error('[private-book] 特別料金のカレンダーを読めませんでした', e instanceof Error ? e.message : e);
    return normal;
  }
}

// ---------------------------------------------------------------------------
// 仮押さえ
// ---------------------------------------------------------------------------

export type PrivateBookHoldOutcome =
  /** プライベートブックの束にしない（状態でない・特別料金の施設でない・特別料金で出せない部屋がある）→ 呼び出し側がふつうの仮押さえ */
  | { kind: 'normal' }
  | { kind: 'member'; result: MemberHoldResult; idOfCode: (code: string) => string | undefined };

/**
 * プラン詳細の ?/hold（とかごの送信）で、状態が有効な施設なら特別会員の束を作る。
 * クッキー・locals を信じず、ここで状態（verifyPrivateBook）と施設の設定を読み直し、料金も quoteMemberRooms で計算し直す。
 * 特別料金で出せない部屋が 1 室でもあれば normal（画面でもその部屋はふつうの料金で出ている）
 */
export async function privateBookHold(args: {
  event: Pick<RequestEvent, 'cookies' | 'locals'>;
  facilityId: string;
  rooms: { planId: string; roomTypeId: string; adults: number }[];
  checkIn: string;
  nights: number;
  sessionId: string;
  clientKey: string;
  locale?: string;
}): Promise<PrivateBookHoldOutcome> {
  const sb = service();
  const user = args.event.locals.user;
  const cookie = parsePbCookie(args.event.cookies.get(PB_COOKIE));
  if (!sb || !cookie || user?.role !== 'member') return { kind: 'normal' };
  const state = await verifyPrivateBook(user.id, cookie);
  if (!state) {
    clearPrivateBookCookie(args.event.cookies);
    return { kind: 'normal' };
  }
  const fac = await privateBookFacility(state, args.facilityId);
  if (!fac?.special) return { kind: 'normal' };
  const [{ idToPlan }, codes] = await Promise.all([planMaps(sb, args.facilityId), roomTypeCodes(sb, args.facilityId)]);
  const memberRooms: MemberHoldRoom[] = [];
  for (const r of args.rooms) {
    const plan = idToPlan.get(r.planId);
    const roomCode = codes.idToCode.get(r.roomTypeId);
    if (!plan || !roomCode) return { kind: 'normal' };
    memberRooms.push({ roomCode, planCode: plan.planCode, planName: plan.planLabel, adults: r.adults });
  }
  if (!stayAllowed(fac.ctx, args.checkIn, args.nights)) return { kind: 'normal' };
  // 料金を出せるか（残室は束を作るときに確かめる）。出せなければふつうの仮押さえ
  const priced = await quoteMemberRooms(sb, fac.ctx, memberRooms, args.checkIn, args.nights, { ignoreRemaining: true }).catch(() => null);
  if (!priced?.ok) return { kind: 'normal' };
  const result = await createMemberPageHoldCore({
    db: sb,
    partner: fac.ctx,
    memberUserId: user.id,
    rooms: memberRooms,
    checkIn: args.checkIn,
    nights: args.nights,
    sessionId: args.sessionId,
    clientKey: args.clientKey,
    locale: args.locale
  });
  return { kind: 'member', result, idOfCode: (code) => codes.codeToId.get(code) };
}
