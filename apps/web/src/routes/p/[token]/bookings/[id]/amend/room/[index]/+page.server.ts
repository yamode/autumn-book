// 特別会員の専用ページ: ご予約の「このお部屋を変更」（部屋タイプ・プラン・人数・公式の複数室 M3・docs/official-multi-room.md §17.3.2・§18）。
// 室数を問わず（1 室の予約も）。日程は変えない（日程は amend/）。料金は専用料金で計算し直す:
//   候補 … 料金カレンダーで今の日程の全泊に出ている部屋タイプ × 公開プランを、人数（?adults=）ごとに quotePartnerBooking で
//   見積 … 選んだ候補（?room=&plan=&name=）の泊明細と新しいプランの専用特典 → book.member_page_quote_amendment_rooms
//   確定 … ?/confirm（roomCode・planCode・planName・adults）→ 泊明細を作り直して book.member_page_amend_booking_rooms（画面の金額は受け取らない）
// 規則（締切・回数〔日程変更と共有・2 + (室数 − 1)〕・ペナルティ・在庫・定員・支払方法の両立・オンライン決済済みは不可）は DB が確かめる。
import { error, fail, redirect } from '@sveltejs/kit';
import { memberPageHrefOf } from '$lib/partner-member-page';
import { AMEND_ROOM_MESSAGES_JA, amendLimitOf, amendRoomErrorCode, amendRoomErrorStatus, parseAdults } from '$lib/multi-room';
import { createSupabaseServerClient } from '$lib/server/auth';
import { directPaymentForBooking } from '$lib/server/direct-payments';
import { sbListMyAmendments, type AmendRoomsQuote } from '$lib/server/supabase-data';
import {
  memberAmendRoomInput,
  memberPageAmendRooms,
  memberPageBookingRooms,
  memberPageOpError,
  memberPageQuoteAmendRooms,
  memberRoomCandidates,
  type MemberRoomCandidate
} from '$lib/server/partners/member-bookings';
import { deferTask, portalHeader, portalLogActor, PORTAL_HEADERS, requestMeta, requireMemberPortal, requirePortalSession } from '$lib/server/partners/portal';
import { logPartnerAccess } from '$lib/server/partners/store';

const CODE_RE = /^[A-Za-z0-9_.-]{1,40}$/;

async function isPrepaidOnline(code: string): Promise<boolean> {
  const pay = await directPaymentForBooking(code).catch(() => null);
  return !!pay && pay.status === 'paid' && pay.refund_status !== 'full';
}

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  requireMemberPortal(partner);
  if (!session.member) throw error(404, '確認モードではご予約の変更はできません。');
  const token = event.params.token;
  const code = event.params.id;
  const detailHref = memberPageHrefOf(token, code);
  const index = Number(event.params.index);
  if (!Number.isInteger(index) || index < 1) throw error(404, 'お部屋が見つかりません。');
  const who = { partnerId: partner.id, memberUserId: session.member.userId, code };
  let booking;
  try {
    booking = await memberPageBookingRooms(who);
  } catch (e) {
    const err = memberPageOpError(e);
    throw error(err.status === 500 ? 503 : err.status, err.message);
  }
  if (booking.status !== 'confirmed') throw redirect(303, detailHref);
  const room = booking.rooms.find((r) => r.index === index && !r.cancelled);
  if (!room) throw error(404, 'お部屋が見つかりません。');

  const amendCount = (await sbListMyAmendments(createSupabaseServerClient(event), code).catch(() => [])).length;
  const limit = amendLimitOf(booking.rooms.length);
  const base = {
    portal: portalHeader(partner, session),
    code,
    checkin: booking.checkIn,
    nights: booking.nights,
    room: { index, roomCode: room.roomCode, roomName: room.roomName, planCode: room.planCode, planName: room.planLabel, adults: room.adults, total: room.roomTotal },
    amendRemaining: Math.max(0, limit - amendCount),
    amendLimit: limit,
    hrefs: { back: detailHref, self: `${detailHref}/amend/room/${index}` }
  };
  // オンライン決済済みは変更不可（取消 → 取り直しか電話・決定 M2）
  if (await isPrepaidOnline(code)) {
    return { ...base, adults: room.adults, candidates: [] as MemberRoomCandidate[], selected: null, quote: null, quoteError: AMEND_ROOM_MESSAGES_JA.prepaid_online, unavailable: AMEND_ROOM_MESSAGES_JA.prepaid_online };
  }

  const q = event.url.searchParams;
  const adults = parseAdults(q.get('adults')) ?? room.adults;
  const cand = await memberRoomCandidates(db, partner, booking, index, adults);
  if (!cand.ok) {
    return { ...base, adults, candidates: [] as MemberRoomCandidate[], selected: null, quote: null, quoteError: null, unavailable: cand.message };
  }
  // 選んだ候補（?room=&plan=&name=）。無ければ今の組み合わせ
  const selRoom = q.get('room') ?? room.roomCode;
  const selPlan = q.get('plan') ?? room.planCode;
  const selName = q.get('name') ?? room.planLabel;
  const sel = cand.candidates.find((c) => c.roomCode === selRoom && c.planCode === selPlan && c.planName === selName) ?? null;

  let quote: AmendRoomsQuote | null = null;
  let quoteError: string | null = null;
  const changed = !!sel && (sel.roomCode !== room.roomCode || sel.planCode !== room.planCode || sel.planName !== room.planLabel || adults !== room.adults);
  if (sel && changed) {
    const input = await memberAmendRoomInput(db, partner, booking, index, { roomCode: sel.roomCode, planCode: sel.planCode, planName: sel.planName, adults });
    if (!input.ok) quoteError = input.message;
    else {
      try {
        quote = await memberPageQuoteAmendRooms(who, [input.input]);
      } catch (e) {
        quoteError = AMEND_ROOM_MESSAGES_JA[amendRoomErrorCode(e)];
      }
    }
  } else if (q.has('room') && !sel) {
    quoteError = 'このお部屋・プランは選べません（専用料金が設定されていない日があります）。';
  }
  return {
    ...base,
    adults,
    candidates: cand.candidates,
    selected: sel ? { roomCode: sel.roomCode, planCode: sel.planCode, planName: sel.planName } : null,
    quote,
    quoteError,
    unavailable: null as string | null,
    ...(quote ? { amendRemaining: quote.amendRemaining, amendLimit: quote.amendLimit } : {})
  };
};

export const actions = {
  // 確定（roomCode・planCode・planName・adults）。泊明細と特典はサーバが作り直す
  confirm: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    requireMemberPortal(partner);
    if (!session.member) return fail(403, { code: 'forbidden', message: 'ご招待の会員さまでログインしてください。' });
    const code = event.params.id;
    const index = Number(event.params.index);
    const fd = await event.request.formData();
    const roomCode = String(fd.get('roomCode') ?? '');
    const planCode = String(fd.get('planCode') ?? '');
    const planName = String(fd.get('planName') ?? '').trim();
    const adults = parseAdults(fd.get('adults'));
    if (!Number.isInteger(index) || index < 1 || !CODE_RE.test(roomCode) || !CODE_RE.test(planCode) || !planName || planName.length > 200 || adults === null) {
      return fail(400, { code: 'invalid', message: AMEND_ROOM_MESSAGES_JA.invalid });
    }
    const who = { partnerId: partner.id, memberUserId: session.member.userId, code };
    try {
      const booking = await memberPageBookingRooms(who);
      const input = await memberAmendRoomInput(db, partner, booking, index, { roomCode, planCode, planName, adults });
      if (!input.ok) return fail(400, { code: 'unavailable', message: input.message });
      await memberPageAmendRooms(who, [input.input]);
    } catch (e) {
      const c = amendRoomErrorCode(e);
      return fail(amendRoomErrorStatus(c), { code: c, message: AMEND_ROOM_MESSAGES_JA[c] });
    }
    deferTask(
      event,
      logPartnerAccess(db, {
        partnerId: partner.id,
        ...portalLogActor(session, { code, room_index: index, room: roomCode, plan: planCode, adults }),
        channel: 'web',
        action: 'booking_amend',
        ip: requestMeta(event).ip
      })
    );
    throw redirect(303, memberPageHrefOf(event.params.token, code));
  }
};
