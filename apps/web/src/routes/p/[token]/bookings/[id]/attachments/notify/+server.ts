// 予約の添付ファイルの変更を宿（PMS）へ知らせる。画面が追加・削除のあとにまとめて1回呼ぶ（§6.2）。
// body: { added: [ファイル名], removed: [ファイル名] }（通知の文面の材料。同期は電文の全件で行うので、中身は信用しない）。
// PMS へまだ送っていない予約（支払待ち）・変化の無い予約には DB 関数が電文を出さない（sent: false）。
import { json } from '@sveltejs/kit';
import { notifyBookingAttachments } from '$lib/server/partners/booking-attachments';
import { PORTAL_HEADERS } from '$lib/server/partners/portal';
import { attachmentApiError, requireAttachmentBooking } from '$lib/server/partners/portal-attachments';

export const POST = async (event) => {
  const { db, session, booking } = await requireAttachmentBooking(event);
  const body = (await event.request.json().catch(() => ({}))) as { added?: unknown; removed?: unknown };
  try {
    const r = await notifyBookingAttachments(db, booking.id, body, { kind: 'partner', label: session.login_id });
    return json({ ok: true, sent: r.sent }, { headers: PORTAL_HEADERS });
  } catch (e) {
    return attachmentApiError(e);
  }
};
