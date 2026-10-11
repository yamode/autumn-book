// 特別会員の専用ページ: ご予約の日程変更（/p/<token>/bookings/<予約番号>/amend・docs/vip-member-page.md §13.4.3b・Q9）。
// 日付・泊数だけ（1 室の予約も。部屋・プラン・人数の変更は取消 → 取り直し）。変更後の料金は専用料金で計算し直す:
//   生きている部屋ごとに料金カレンダーの識別（部屋タイプのコード・プランのコードと名前・人数）で quotePartnerBooking → 泊明細 →
//   book.member_page_quote_amendment_dates（見積）／member_page_amend_booking_dates（確定）。画面の金額は受け取らない。
// 規則（2 回まで・締切・キャンセル料がかかる期間は不可・オンライン決済済みは不可・全室ぶんの在庫）は公式と同じ（DB）。
import { error, fail, redirect } from '@sveltejs/kit';
import { memberPageHrefOf } from '$lib/partner-member-page';
import {
  memberAmendLines,
  memberPageAmendDates,
  memberPageBookingRooms,
  memberPageOpError,
  memberPageQuoteAmendDates
} from '$lib/server/partners/member-bookings';
import { deferTask, portalHeader, portalLogActor, PORTAL_HEADERS, requestMeta, requireMemberPortal, requirePortalSession } from '$lib/server/partners/portal';
import { logPartnerAccess, todayJst } from '$lib/server/partners/store';
import type { AmendDatesQuote } from '$lib/server/supabase-data';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const clampNights = (raw: unknown, max: number) => Math.min(max, Math.max(1, Math.round(Number(raw)) || 1));

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  requireMemberPortal(partner);
  if (!session.member) throw error(404, '確認モードではご予約の変更はできません。');
  const token = event.params.token;
  const code = event.params.id;
  const who = { partnerId: partner.id, memberUserId: session.member.userId, code };
  let booking;
  try {
    booking = await memberPageBookingRooms(who);
  } catch (e) {
    const err = memberPageOpError(e);
    throw error(err.status === 500 ? 503 : err.status, err.message);
  }
  if (booking.status !== 'confirmed') throw redirect(303, memberPageHrefOf(token, code));
  const maxNights = partner.booking_settings.maxNights;
  const current = {
    checkin: booking.checkIn,
    nights: booking.nights,
    rooms: booking.rooms
      .filter((r) => !r.cancelled)
      .map((r) => ({ index: r.index, roomCode: r.roomCode, roomName: r.roomName, planCode: r.planCode, planName: r.planLabel, adults: r.adults, total: r.roomTotal }))
  };
  // 変更候補（?checkin=&nights=）があれば見積。無ければ今の日程だけ
  const q = event.url.searchParams;
  const checkin = q.get('checkin') ?? '';
  const nights = clampNights(q.get('nights') ?? current.nights, maxNights);
  let quote: AmendDatesQuote | null = null;
  let unavailable: string | null = null;
  if (ISO.test(checkin)) {
    if (checkin < todayJst()) unavailable = '過去の日付には変更できません。';
    else {
      const lines = await memberAmendLines(db, partner, booking, checkin, nights);
      if (!lines.ok) unavailable = lines.message;
      else {
        try {
          quote = await memberPageQuoteAmendDates(who, checkin, nights, lines.rooms);
        } catch (e) {
          unavailable = memberPageOpError(e).message;
        }
      }
    }
  }
  return {
    portal: portalHeader(partner, session),
    code,
    current,
    candidate: ISO.test(checkin) ? { checkin, nights } : null,
    quote,
    unavailable,
    maxNights,
    hrefs: { back: memberPageHrefOf(token, code), self: `${memberPageHrefOf(token, code)}/amend` }
  };
};

export const actions = {
  // 確定（checkin・nights）。泊明細はサーバが計算し直す
  amend: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    requireMemberPortal(partner);
    if (!session.member) return fail(403, { code: 'forbidden', message: 'ご招待の会員さまでログインしてください。' });
    const code = event.params.id;
    const fd = await event.request.formData();
    const checkin = String(fd.get('checkin') ?? '');
    const nights = clampNights(fd.get('nights'), partner.booking_settings.maxNights);
    if (!ISO.test(checkin)) return fail(400, { code: 'invalid', message: '日付を選んでください。' });
    const who = { partnerId: partner.id, memberUserId: session.member.userId, code };
    try {
      const booking = await memberPageBookingRooms(who);
      const lines = await memberAmendLines(db, partner, booking, checkin, nights);
      if (!lines.ok) return fail(400, { code: 'unavailable', message: lines.message });
      await memberPageAmendDates(who, checkin, nights, lines.rooms);
    } catch (e) {
      const err = memberPageOpError(e);
      return fail(err.status, { code: err.code, message: err.message });
    }
    deferTask(
      event,
      logPartnerAccess(db, { partnerId: partner.id, ...portalLogActor(session, { code, checkin, nights }), channel: 'web', action: 'booking_amend', ip: requestMeta(event).ip })
    );
    throw redirect(303, memberPageHrefOf(event.params.token, code));
  }
};
