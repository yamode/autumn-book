// 特別会員の専用ページの「ご予約一覧」（/p/<token>/bookings の member 版・docs/vip-member-page.md §13.4.3b・§14）。
//
//   読み取り: 会員の authenticated クライアントで公式マイページと同じ RPC（my_reservations など）を呼び、このページから本人が予約した分だけ
//   操作:     service_role の入口 book.member_page_*（対象者・このページの予約・予約した本人を DB で確かめ、会員を名乗って既存の RPC を呼ぶ）
//   日程変更: 専用料金で計算し直す（生きている部屋ごとに quotePartnerBooking → 泊明細 → member_page_*_dates）
import type { SupabaseClient } from '@supabase/supabase-js';
import { memberPageBookingsOf, memberPageCalendarHrefOf, memberPageHrefOf, type MemberAmendRoomLines, type MemberHoldRoom } from '$lib/partner-member-page';
import { mapAmendDatesQuote, type AmendDatesQuote, type AmendResult, type MemberReservation } from '$lib/server/supabase-data';
import { partnerServiceClient } from './admin-client';
import { quoteMemberRooms } from './member-hold';
import { loadPartnerContext, memberPagesFor, type PartnerContext } from './store';

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
