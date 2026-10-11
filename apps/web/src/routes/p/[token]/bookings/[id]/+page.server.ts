// 特別会員の専用ページ: ご予約の詳細（/p/<token>/bookings/<予約番号>・docs/vip-member-page.md §13.4.3b・§14）。
// 取引先（agent / corporate / other）にはこのページは無い（404。取引先予約の詳細は一覧のモーダル）。
// ディレクトリ名が [id] なのは、取引先予約の添付（/bookings/[id]/attachments）と同じ階層に置くため（値は予約番号）。
//
// 読み取り: 会員の authenticated クライアント（公式マイページの予約詳細と同じ部品 reservationDetailOf）
// 操作:     取消（全室・1 室）は service_role の入口 book.member_page_*（会員を名乗って公式の取消を呼ぶ）→ 返金は公式と同じ refundAfterCancel
//           オプションの取消は会員のクライアントで公式と同じ（cancel_booking_option はガードの対象外）
import { error, fail } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbCancelBookingOption, sbMyReservations, type MemberReservation } from '$lib/server/supabase-data';
import { reservationDetailOf } from '$lib/server/member-reservation-detail';
import { refundAfterCancel } from '$lib/server/direct-payments';
import { memberPageHrefOf } from '$lib/partner-member-page';
import {
  memberPageCancelBooking,
  memberPageCancelBookingRoom,
  memberPageOpError,
  memberPageReservations
} from '$lib/server/partners/member-bookings';
import { deferTask, portalHeader, portalLogActor, PORTAL_HEADERS, requestMeta, requireMemberPortal, requirePortalSession } from '$lib/server/partners/portal';
import { logPartnerAccess, type PartnerContext, type PartnerSessionAccount } from '$lib/server/partners/store';
import type { RequestEvent } from '@sveltejs/kit';

/** このページから本人が予約した予約を 1 件（無ければ 404） */
async function ownReservation(event: RequestEvent, partner: PartnerContext, session: PartnerSessionAccount, code: string): Promise<MemberReservation> {
  if (!session.member) throw error(404, '確認モードではご予約の詳細は表示されません。');
  const all = await sbMyReservations(createSupabaseServerClient(event)).catch(() => {
    throw error(503, 'ご予約を読み込めませんでした。時間をおいてお試しください。');
  });
  const r = memberPageReservations(all, partner.id, session.member.userId).find((x) => x.code === code);
  if (!r) throw error(404, 'ご予約が見つかりません。');
  return r;
}

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  requireMemberPortal(partner);
  const token = event.params.token;
  const code = event.params.id;
  const r = await ownReservation(event, partner, session, code);
  const detail = await reservationDetailOf(event, createSupabaseServerClient(event), r);
  deferTask(
    event,
    logPartnerAccess(db, { partnerId: partner.id, ...portalLogActor(session, { code }), channel: 'web', action: 'booking_view', ip: requestMeta(event).ip })
  );
  return {
    portal: portalHeader(partner, session),
    ...detail,
    facilityName: partner.facilities.find((f) => f.id === r.facilityUuid)?.name ?? '',
    // 取消（部屋ごと）の可否は rooms[i].canCancel、全室の取消は「予約中」のとき。日程変更は amend.canAmend（2 回まで・締切前）
    canCancel: r.status === 'reserved',
    canCancelRoom: detail.rooms.some((x) => x.canCancel),
    canAmend: detail.amend.canAmend && r.payment === 'onsite',
    hrefs: {
      self: memberPageHrefOf(token, code),
      amend: `${memberPageHrefOf(token, code)}/amend`,
      options: `${memberPageHrefOf(token, code)}/options`,
      back: `/p/${token}/bookings`
    }
  };
};

export const actions = {
  // すべてのお部屋（生きている部屋をまとめて）を取り消す。オンライン決済済みなら返金（公式の会員の取消と同じ）
  cancel: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    requireMemberPortal(partner);
    if (!session.member) return fail(403, { code: 'forbidden', message: 'ご招待の会員さまでログインしてください。' });
    const code = event.params.id;
    try {
      await memberPageCancelBooking({ partnerId: partner.id, memberUserId: session.member.userId, code });
    } catch (e) {
      const err = memberPageOpError(e);
      return fail(err.status, { code: err.code, message: err.message });
    }
    const refund = await refundAfterCancel(code, 'member').catch(() => ({ kind: 'none' as const }));
    deferTask(event, logPartnerAccess(db, { partnerId: partner.id, ...portalLogActor(session, { code }), channel: 'web', action: 'booking_cancel', ip: requestMeta(event).ip }));
    return { cancelled: true as const, refund };
  },

  // 1 室だけ取り消す（最後の 1 室なら予約全体の取消）。オンライン決済済みならこの部屋の分を返金
  cancelRoom: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    requireMemberPortal(partner);
    if (!session.member) return fail(403, { code: 'forbidden', message: 'ご招待の会員さまでログインしてください。' });
    const code = event.params.id;
    const roomIndex = Number((await event.request.formData()).get('roomIndex'));
    if (!Number.isInteger(roomIndex) || roomIndex < 1) return fail(400, { code: 'invalid', message: 'お部屋を選び直してください。' });
    let res;
    try {
      res = await memberPageCancelBookingRoom({ partnerId: partner.id, memberUserId: session.member.userId, code }, roomIndex);
    } catch (e) {
      const err = memberPageOpError(e);
      return fail(err.status, { code: err.code, message: err.message });
    }
    const refund = await refundAfterCancel(code, 'member', { roomIndex }).catch(() => ({ kind: 'none' as const }));
    deferTask(
      event,
      logPartnerAccess(db, { partnerId: partner.id, ...portalLogActor(session, { code, room_index: roomIndex }), channel: 'web', action: 'booking_cancel', ip: requestMeta(event).ip })
    );
    return {
      roomCancelled: { index: roomIndex, fee: res.cancellation_fee, bookingCancelled: res.booking_cancelled },
      cancelled: res.booking_cancelled,
      refund
    };
  },

  // オプション（滞在アレンジ）明細の取消（本人・提供日前日まで。公式マイページと同じ RPC）
  cancelOption: async (event) => {
    const { partner, session } = await requirePortalSession(event);
    requireMemberPortal(partner);
    const r = await ownReservation(event, partner, session, event.params.id);
    const orderId = String((await event.request.formData()).get('orderId') ?? '');
    if (!orderId) return fail(400, { code: 'invalid', message: 'アレンジを取り消せませんでした。' });
    try {
      await sbCancelBookingOption(createSupabaseServerClient(event), orderId);
    } catch {
      return fail(400, { code: 'option_failed', message: 'アレンジを取り消せませんでした。' });
    }
    return { optionCancelled: true as const, code: r.code };
  }
};
