// 予約一覧（/p/[token]/bookings）から予約に添付ファイルを追加する（1リクエスト1ファイル・§6.2）。
// 予約は取引先（partner_id）条件つきで引き、状態（取消済み・期限切れ・チェックアウトから 90 日超は不可）を確かめる。
// PMS への反映は、画面が追加・削除のあとにまとめて notify を1回呼ぶ（./notify）。
import { json } from '@sveltejs/kit';
import { rejectOversizedUpload, uploadBookingAttachment } from '$lib/server/partners/booking-attachments';
import { PORTAL_HEADERS } from '$lib/server/partners/portal';
import { attachmentApiError, logAttachment, portalAttachmentView, requireAttachmentBooking } from '$lib/server/partners/portal-attachments';

export const POST = async (event) => {
  const ctx = await requireAttachmentBooking(event);
  const { db, partner, session, booking, policy } = ctx;
  if (!policy.canAdd) return json({ ok: false, message: policy.note ?? 'このご予約には添付ファイルを追加できません。' }, { status: 400, headers: PORTAL_HEADERS });
  const tooLarge = rejectOversizedUpload(event.request, PORTAL_HEADERS);
  if (tooLarge) return tooLarge;
  const fd = await event.request.formData().catch(() => null);
  const file = fd?.get('file');
  if (!(file instanceof File) || file.size === 0) return json({ ok: false, message: 'ファイルを選んでください。' }, { status: 400, headers: PORTAL_HEADERS });
  try {
    const target = { bookingId: booking.id };
    const row = await uploadBookingAttachment(db, partner, file, { kind: 'partner', accountId: session.id, label: session.login_id }, target);
    await logAttachment(event, ctx, 'attachment_add', { attachmentId: row.id, bookingCode: booking.booking_code, fileName: row.file_name, bytes: row.byte_size });
    return json({ ok: true, attachment: portalAttachmentView(event.params.token, target, row, session, policy.canDelete) }, { headers: PORTAL_HEADERS });
  } catch (e) {
    return attachmentApiError(e);
  }
};
