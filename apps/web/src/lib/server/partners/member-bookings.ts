// 特別会員の専用ページの「ご予約一覧」（/p/<token>/bookings の member 版・docs/vip-member-page.md §13.4.3b・§14）。
//
//   読み取り: 会員の authenticated クライアントで公式マイページと同じ RPC（my_reservations など）を呼び、このページから本人が予約した分だけ
//   操作:     service_role の入口 book.member_page_*（対象者・このページの予約・予約した本人を DB で確かめ、会員を名乗って既存の RPC を呼ぶ）
//   日程変更: 専用料金で計算し直す（生きている部屋ごとに quotePartnerBooking → 泊明細 → member_page_*_dates）
//   部屋の変更（M3）: 変える部屋の専用料金と新しいプランの特典 → member_page_*_rooms
import type { SupabaseClient } from '@supabase/supabase-js';
import { memberPageBookingsOf, memberPageCalendarHrefOf, memberPageHrefOf, perksSnapshotOf, type MemberAmendRoomLines, type MemberHoldRoom } from '$lib/partner-member-page';
import { perksForPlan } from '$lib/partner-booking';
import { amendRoomsPayload, type AmendRoomInput } from '$lib/multi-room';
import {
  mapAmendDatesQuote,
  mapAmendRoomsQuote,
  mapAmendRoomsResult,
  type AmendDatesQuote,
  type AmendResult,
  type AmendRoomsQuote,
  type AmendRoomsResult,
  type MemberReservation
} from '$lib/server/supabase-data';
import { partnerServiceClient } from './admin-client';
import { quotePartnerBooking } from './booking';
import { loadMemberPagePlans, memberPlanKey, quoteMemberRooms } from './member-hold';
import { loadPartnerRates } from './rates';
import { addDaysIso, loadPartnerContext, memberPagesFor, type PartnerContext } from './store';

/** このページから本人が予約した分（家族・公式・別ページの予約は出さない・Q10） */
export const memberPageReservations = (all: readonly MemberReservation[], partnerId: string, memberUserId: string): MemberReservation[] =>
  memberPageBookingsOf(all, partnerId, memberUserId);

/** DB の例外 → 画面のコードと文言（純関数は lib/partner-member-page.ts・判定は具体的な語から） */
export { memberPageOpError, type MemberPageOpError } from '$lib/partner-member-page';

function service(): SupabaseClient {
  const sb = partnerServiceClient();
  if (!sb) throw new Error('member_page: service_role クライアントが未設定');
  return sb;
}

type Who = { partnerId: string; memberUserId: string; code: string };
const whoArgs = (w: Who) => ({ p_partner_id: w.partnerId, p_member_user_id: w.memberUserId, p_booking_code: w.code });

/** 全室（生きている部屋をまとめて）取消。戻りは cancel_booking と同じ */
export async function memberPageCancelBooking(w: Who): Promise<{ booking_code: string; cancellation_fee: number }> {
  const { data, error } = await service().schema('book').rpc('member_page_cancel_booking', whoArgs(w));
  if (error) throw error;
  return data as { booking_code: string; cancellation_fee: number };
}

/** 1 室の取消（最後の 1 室なら予約全体の取消）。戻りは cancel_booking_room と同じ */
export async function memberPageCancelBookingRoom(
  w: Who,
  roomIndex: number
): Promise<{ booking_code: string; room_index: number; cancellation_fee: number; remaining_rooms: number; booking_cancelled: boolean }> {
  const { data, error } = await service().schema('book').rpc('member_page_cancel_booking_room', { ...whoArgs(w), p_room_index: roomIndex });
  if (error) throw error;
  return data as { booking_code: string; room_index: number; cancellation_fee: number; remaining_rooms: number; booking_cancelled: boolean };
}

/** オプション（滞在アレンジ）の追加。items は sbAddBookingOptions と同じ形 */
export async function memberPageAddOptions(
  w: Who,
  items: { optionId: string; serviceDate?: string | null; quantity: number; note?: string; roomIndex?: number | null }[]
): Promise<{ total_added: number }> {
  const { data, error } = await service()
    .schema('book')
    .rpc('member_page_add_booking_options', {
      ...whoArgs(w),
      p_items: items.map((i) => ({
        option_id: i.optionId,
        service_date: i.serviceDate ?? null,
        quantity: i.quantity,
        note: i.note ?? null,
        ...(i.roomIndex != null ? { room_index: i.roomIndex } : {})
      }))
    });
  if (error) throw error;
  return data as { total_added: number };
}

/** 予約の部屋（料金カレンダーの識別つき・book.member_page_booking_rooms） */
export type MemberBookingRooms = {
  bookingCode: string;
  facilityId: string;
  checkIn: string;
  nights: number;
  status: string;
  rooms: {
    index: number;
    cancelled: boolean;
    stayStatus: string;
    adults: number;
    roomCode: string;
    roomName: string;
    planCode: string;
    planLabel: string;
    roomTotal: number;
  }[];
};

export async function memberPageBookingRooms(w: Who): Promise<MemberBookingRooms> {
  const { data, error } = await service().schema('book').rpc('member_page_booking_rooms', whoArgs(w));
  if (error) throw error;
  const r = data as Record<string, unknown>;
  const rooms = (Array.isArray(r.rooms) ? r.rooms : []) as Record<string, unknown>[];
  return {
    bookingCode: String(r.booking_code ?? w.code),
    facilityId: String(r.facility_id ?? ''),
    checkIn: String(r.check_in_date ?? ''),
    nights: Number(r.nights ?? 1),
    status: String(r.status ?? ''),
    rooms: rooms.map((x) => ({
      index: Number(x.room_index),
      cancelled: x.cancelled === true,
      stayStatus: String(x.stay_status ?? ''),
      adults: Number(x.adults ?? 1),
      roomCode: String(x.room_code ?? ''),
      roomName: String(x.room_name ?? ''),
      planCode: String(x.plan_code ?? ''),
      planLabel: String(x.plan_label ?? ''),
      roomTotal: Number(x.room_total ?? 0)
    }))
  };
}

/**
 * 日程変更の泊明細（生きている部屋ごとに、変更後の日程の専用料金を quotePartnerBooking で出す）。
 * 料金ルールは予約した施設の設定で計算する（選んでいる施設ではない）。料金を出せない日は { ok: false, message }。
 */
export async function memberAmendLines(
  db: SupabaseClient,
  partner: PartnerContext,
  booking: MemberBookingRooms,
  checkIn: string,
  nights: number
): Promise<{ ok: true; rooms: MemberAmendRoomLines[] } | { ok: false; message: string }> {
  const ctx = booking.facilityId && booking.facilityId !== partner.facility_id ? await loadPartnerContext(db, partner.id, booking.facilityId) : partner;
  if (!ctx || !ctx.facility_available) return { ok: false, message: 'この日程には変更できません（ご予約の施設は現在専用ページでご案内していません）。' };
  const live = booking.rooms.filter((r) => !r.cancelled);
  if (!live.length) return { ok: false, message: 'このご予約は変更できません。' };
  const reqs: MemberHoldRoom[] = live.map((r) => ({ roomCode: r.roomCode, planCode: r.planCode, planName: r.planLabel, adults: r.adults }));
  // 在庫は DB（member_page_*_dates）が自分の部屋を足し戻して確かめるので、ここでは料金だけ（残室の判定はしない）
  const q = await quoteMemberRooms(db, ctx, reqs, checkIn, nights, { ignoreRemaining: true });
  if (!q.ok) return { ok: false, message: `この日程には変更できません。${q.message}` };
  return { ok: true, rooms: q.rooms.map((r, i) => ({ room_index: live[i].index, lines: r.lines })) };
}

/** 日程変更の見積（専用料金・部屋ごとの今と変更後・クーポン／ポイントの再按分・ペナルティ・在庫の目安） */
export async function memberPageQuoteAmendDates(w: Who, checkIn: string, nights: number, rooms: MemberAmendRoomLines[]): Promise<AmendDatesQuote> {
  const { data, error } = await service()
    .schema('book')
    .rpc('member_page_quote_amendment_dates', { ...whoArgs(w), p_checkin: checkIn, p_nights: nights, p_rooms: rooms });
  if (error) throw error;
  return mapAmendDatesQuote(data as Record<string, unknown>);
}

/** 日程変更の確定（専用料金）。戻りは amend_booking_dates と同じ */
export async function memberPageAmendDates(w: Who, checkIn: string, nights: number, rooms: MemberAmendRoomLines[]): Promise<AmendResult> {
  const { data, error } = await service()
    .schema('book')
    .rpc('member_page_amend_booking_dates', { ...whoArgs(w), p_checkin: checkIn, p_nights: nights, p_rooms: rooms });
  if (error) throw error;
  return data as AmendResult;
}

/** 専用ページの予約詳細の URL（限定 URL のトークンは service_role で引く）。引けなければ null */
export async function memberPageHrefFor(partnerId: string, code: string): Promise<string | null> {
  const sb = partnerServiceClient();
  if (!sb) return null;
  const { data } = await sb.from('rms_partners').select('url_token').eq('id', partnerId).maybeSingle();
  const token = (data as { url_token?: string } | null)?.url_token;
  return token ? memberPageHrefOf(token, code) : null;
}

/** マイページのトップの「あなた専用のページ」（本人・家族の公開中の専用ページ）。使えない環境・読めなければ空 */
export async function listMemberPagesFor(memberUserId: string): Promise<{ name: string; href: string; facilityNames: string[]; via: 'self' | 'family' }[]> {
  const sb = partnerServiceClient();
  if (!sb) return [];
  const pages = await memberPagesFor(sb, memberUserId).catch(() => []);
  return pages.map((p) => ({ name: p.name, href: memberPageCalendarHrefOf(p.urlToken), facilityNames: p.facilityNames, via: p.via }));
}

// ---------------------------------------------------------------------------
// 部屋ごとの部屋タイプ・プラン・人数の変更（公式の複数室 M3・docs/official-multi-room.md §17.3.2・§18）
//   専用ページは室数を問わず（1 室も）。料金は専用料金（quotePartnerBooking）で計算し直し、泊明細と新しいプランの専用特典を
//   book.member_page_quote_amendment_rooms / member_page_amend_booking_rooms に渡す（画面の金額は受け取らない）。
//   部屋タイプ・プランは料金カレンダーの識別（部屋タイプのコード・planCode■planName）のまま RPC に渡す（DB がこの施設の中で解決する）
// ---------------------------------------------------------------------------

/** 予約した施設の取引先コンテキスト（選んでいる施設ではなく予約の施設の料金ルール・特典で計算する） */
async function bookingFacilityContext(db: SupabaseClient, partner: PartnerContext, facilityId: string): Promise<PartnerContext | null> {
  const ctx = facilityId && facilityId !== partner.facility_id ? await loadPartnerContext(db, partner.id, facilityId) : partner;
  return ctx && ctx.facility_available ? ctx : null;
}

/** 専用ページの部屋の変更の候補（部屋タイプ × プラン・今の日程・指定の人数の専用料金） */
export type MemberRoomCandidate = {
  roomCode: string;
  roomName: string;
  planCode: string;
  planName: string;
  /** この部屋の専用料金（今の日程・指定の人数） */
  total: number;
  perPerson: number;
  /** 残室（今の空き。自分の部屋の分は含まない）。分からなければ null */
  remaining: number | null;
  /** このプランの専用特典（無ければ null） */
  perks: ReturnType<typeof perksSnapshotOf>;
  /** 今の部屋と同じ部屋タイプ・プラン */
  current: boolean;
  /** 選べるか（現地払いのできるプラン・残室あり〔同じ部屋タイプは残室を問わない〕） */
  selectable: boolean;
  blocked: 'payment' | 'sold_out' | null;
};

/**
 * 変更の候補（料金カレンダーで今の日程の全泊に出ている部屋タイプ × 公開プランの組み合わせのうち、専用料金を出せるもの）。
 * 専用料金を出せない組み合わせは候補から外す。
 */
export async function memberRoomCandidates(
  db: SupabaseClient,
  partner: PartnerContext,
  booking: MemberBookingRooms,
  roomIndex: number,
  adults: number
): Promise<{ ok: true; candidates: MemberRoomCandidate[] } | { ok: false; message: string }> {
  const room = booking.rooms.find((r) => r.index === roomIndex && !r.cancelled);
  if (!room) return { ok: false, message: 'このお部屋は変更できません。' };
  const ctx = await bookingFacilityContext(db, partner, booking.facilityId);
  if (!ctx) return { ok: false, message: 'ご予約の施設は現在専用ページでご案内していないため、お部屋を変更できません。お電話でお問い合わせください。' };
  const lastNight = addDaysIso(booking.checkIn, booking.nights - 1);
  const [rates, plans] = await Promise.all([
    loadPartnerRates(db, ctx, { from: booking.checkIn, to: lastNight }, { guests: [adults] }),
    loadMemberPagePlans(db, ctx.facility_id)
  ]);
  // 全泊に出ている（休館でない）部屋タイプ × プラン
  const counts = new Map<string, { roomCode: string; planCode: string; planName: string; n: number }>();
  for (const day of rates.days) {
    if (day.date < booking.checkIn || day.date > lastNight || day.closed) continue;
    for (const r of day.rooms) {
      for (const p of r.plans) {
        const key = `${r.roomCode}\t${p.planCode}\t${p.planName}`;
        const c = counts.get(key) ?? { roomCode: r.roomCode, planCode: p.planCode, planName: p.planName, n: 0 };
        c.n += 1;
        counts.set(key, c);
      }
    }
  }
  const combos = [...counts.values()].filter((c) => c.n === booking.nights && plans.has(memberPlanKey(c.planCode, c.planName)));
  const quoted = await Promise.all(
    combos.map((c) =>
      quotePartnerBooking(
        db,
        ctx,
        { roomCode: c.roomCode, planCode: c.planCode, planName: c.planName, checkIn: booking.checkIn, nights: booking.nights, rooms: [{ adults }] },
        { credit: false }
      ).then((q) => ({ c, q }))
    )
  );
  const candidates: MemberRoomCandidate[] = [];
  for (const { c, q } of quoted) {
    if (!q.ok) continue;
    const pay = plans.get(memberPlanKey(c.planCode, c.planName))?.pay ?? { onsite: true, prepay: false };
    const sameType = c.roomCode === room.roomCode;
    const blocked: MemberRoomCandidate['blocked'] = !pay.onsite ? 'payment' : !sameType && q.remaining !== null && q.remaining < 1 ? 'sold_out' : null;
    const total = q.rooms[0]?.subtotal ?? q.total;
    candidates.push({
      roomCode: c.roomCode,
      roomName: q.roomName,
      planCode: c.planCode,
      planName: c.planName,
      total,
      perPerson: Math.round(total / Math.max(1, adults)),
      remaining: q.remaining,
      perks: perksSnapshotOf(perksForPlan(ctx.booking_settings.perks, c.planCode), c.planCode),
      current: sameType && c.planCode === room.planCode && c.planName === room.planLabel,
      selectable: blocked === null,
      blocked
    });
  }
  candidates.sort((a, b) => a.roomCode.localeCompare(b.roomCode) || a.planCode.localeCompare(b.planCode) || a.total - b.total);
  return { ok: true, candidates };
}

/** 選んだ変更（料金カレンダーの識別） */
export type MemberRoomChange = { roomCode: string; planCode: string; planName: string; adults: number };

/**
 * 1 室の変更を RPC の入力（AmendRoomInput）にする: 専用料金の泊明細を quotePartnerBooking で作り直し、
 * プランが変わるなら新しいプランの専用特典（今の専用ページの設定・§17.1.10）を添える。料金を出せなければ { ok: false, message }。
 */
export async function memberAmendRoomInput(
  db: SupabaseClient,
  partner: PartnerContext,
  booking: MemberBookingRooms,
  roomIndex: number,
  change: MemberRoomChange
): Promise<{ ok: true; input: AmendRoomInput } | { ok: false; message: string }> {
  const room = booking.rooms.find((r) => r.index === roomIndex && !r.cancelled);
  if (!room) return { ok: false, message: 'このお部屋は変更できません。' };
  const ctx = await bookingFacilityContext(db, partner, booking.facilityId);
  if (!ctx) return { ok: false, message: 'ご予約の施設は現在専用ページでご案内していないため、お部屋を変更できません。お電話でお問い合わせください。' };
  const plans = await loadMemberPagePlans(db, ctx.facility_id);
  if (!plans.has(memberPlanKey(change.planCode, change.planName))) {
    return { ok: false, message: 'このプランは専用ページからお選びいただけません。別のプランをお選びください。' };
  }
  const q = await quoteMemberRooms(db, ctx, [change], booking.checkIn, booking.nights, { ignoreRemaining: true });
  if (!q.ok) return { ok: false, message: `このお部屋・プランには変更できません。${q.message}` };
  const planChanged = change.planCode !== room.planCode || change.planName !== room.planLabel;
  return {
    ok: true,
    input: {
      index: roomIndex,
      ratePlanCode: memberPlanKey(change.planCode, change.planName),
      roomTypeCode: change.roomCode,
      adults: change.adults,
      lines: q.rooms[0].lines,
      ...(planChanged ? { memberPerks: q.rooms[0].perks } : {})
    }
  };
}

/** 部屋の変更の見積（専用料金・この部屋の今と変更後・予約全体の再按分・回数・在庫の目安） */
export async function memberPageQuoteAmendRooms(w: Who, rooms: readonly AmendRoomInput[]): Promise<AmendRoomsQuote> {
  const { data, error } = await service()
    .schema('book')
    .rpc('member_page_quote_amendment_rooms', { ...whoArgs(w), p_rooms: amendRoomsPayload(rooms) });
  if (error) throw error;
  return mapAmendRoomsQuote(data as Record<string, unknown>);
}

/** 部屋の変更の確定（専用料金・新しいプランの特典と規定に差し替え） */
export async function memberPageAmendRooms(w: Who, rooms: readonly AmendRoomInput[]): Promise<AmendRoomsResult> {
  const { data, error } = await service()
    .schema('book')
    .rpc('member_page_amend_booking_rooms', { ...whoArgs(w), p_rooms: amendRoomsPayload(rooms) });
  if (error) throw error;
  return mapAmendRoomsResult(data as Record<string, unknown>);
}

/**
 * 管理画面（スタッフ）が専用ページ経由の予約の部屋を変えるとき（§17.1.4・§17.3.3）: 管理画面の選択（UUID）を料金カレンダーの識別
 * （部屋タイプのコード・planCode■planName）に直し、予約時の専用ページ・予約の施設の料金ルールで泊明細と新しいプランの特典を作る。
 * 専用料金を出せない（このプランは専用ページで扱っていない・休館・料金なし）ときは { ok: false, message }。
 * 予約した会員が対象から外れていても使える（会員の確認はしない。スタッフの操作は DB のガードを通る）
 */
export async function staffMemberAmendRoomInput(args: {
  partnerId: string;
  facilityId: string;
  bookingCode: string;
  checkIn: string;
  nights: number;
  rooms: readonly { index: number; cancelled: boolean; stayStatus: string; adults: number; roomTypeId: string; ratePlanId: string; roomTotal: number }[];
  roomIndex: number;
  change: { ratePlanId: string; roomTypeId: string; adults: number };
}): Promise<{ ok: true; input: AmendRoomInput } | { ok: false; message: string }> {
  const db = service();
  const ctx = await loadPartnerContext(db, args.partnerId, args.facilityId).catch(() => null);
  if (!ctx) return { ok: false, message: 'この予約の専用ページの料金を読み込めませんでした（専用ページが削除されたか、施設がオフです）。' };
  const plans = await loadMemberPagePlans(db, args.facilityId);
  const planById = new Map([...plans.values()].map((p) => [p.ratePlanId, p]));
  const { data } = await db.schema('pms').from('room_types').select('id, code, name').eq('facility_id', args.facilityId);
  const rtById = new Map(((data ?? []) as { id: string; code: string; name: string }[]).map((r) => [r.id, r]));
  const newPlan = planById.get(args.change.ratePlanId);
  if (!newPlan) return { ok: false, message: '専用料金が設定されていません（このプランは専用ページでご案内していません）。' };
  const newRoom = rtById.get(args.change.roomTypeId);
  if (!newRoom) return { ok: false, message: 'この部屋タイプは選べません。' };
  const booking: MemberBookingRooms = {
    bookingCode: args.bookingCode,
    facilityId: args.facilityId,
    checkIn: args.checkIn,
    nights: args.nights,
    status: 'confirmed',
    rooms: args.rooms.map((r) => ({
      index: r.index,
      cancelled: r.cancelled,
      stayStatus: r.stayStatus,
      adults: r.adults,
      roomCode: rtById.get(r.roomTypeId)?.code ?? '',
      roomName: rtById.get(r.roomTypeId)?.name ?? '',
      planCode: planById.get(r.ratePlanId)?.planCode ?? '',
      planLabel: planById.get(r.ratePlanId)?.planLabel ?? '',
      roomTotal: r.roomTotal
    }))
  };
  return memberAmendRoomInput(db, ctx, booking, args.roomIndex, {
    roomCode: newRoom.code,
    planCode: newPlan.planCode,
    planName: newPlan.planLabel,
    adults: args.change.adults
  });
}
