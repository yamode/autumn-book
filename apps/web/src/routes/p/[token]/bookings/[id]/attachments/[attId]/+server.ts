// 予約の添付ファイル1件: ダウンロード（GET・確認モードでも見られる）と削除（DELETE）。
// 削除できるのは、自分のログインIDで上げたもの・マスターなら取引先が上げた全件（宿が付けたものは不可）。
// 予約の状態（期限切れ・チェックアウトから 90 日超）でも断る。
import { error, json } from '@sveltejs/kit';
import { partnerCanDeleteAttachment } from '$lib/partner-attachments';
import { documentResponse } from '$lib/server/partners/memorandum';
import { deleteBookingAttachment, downloadBookingAttachment, getBookingAttachment } from '$lib/server/partners/booking-attachments';
import { PORTAL_HEADERS } from '$lib/server/partners/portal';
import { attachmentApiError, logAttachment, requireAttachmentBooking } from '$lib/server/partners/portal-attachments';

export const GET = async (event) => {
  const { db, partner, booking } = await requireAttachmentBooking(event);
  let found;
  try {
    found = await downloadBookingAttachment(db, partner.id, event.params.attId, { bookingId: booking.id });
  } catch {
    throw error(503, 'ファイルを読み込めませんでした。時間をおいてお試しください。');
  }
  if (!found) throw error(404, 'ファイルが見つかりません。');
  return documentResponse(found.row, found.body, PORTAL_HEADERS);
};

export const DELETE = async (event) => {
  const ctx = await requireAttachmentBooking(event);
  const { db, partner, session, booking, policy } = ctx;
  try {
    const row = await getBookingAttachment(db, partner.id, event.params.attId, { bookingId: booking.id });
    if (!row) return json({ ok: false, message: 'ファイルが見つかりません。' }, { status: 404, headers: PORTAL_HEADERS });
    if (!policy.canDelete) return json({ ok: false, message: policy.note ?? 'このご予約の添付ファイルは削除できません。' }, { status: 400, headers: PORTAL_HEADERS });
    if (!partnerCanDeleteAttachment(row, session)) {
      return json(
        { ok: false, message: row.uploaded_by_kind === 'staff' ? '宿が付けたファイルは削除できません。' : 'ご自身で付けたファイルだけ削除できます（マスターのログインIDならすべて）。' },
        { status: 403, headers: PORTAL_HEADERS }
      );
    }
    await deleteBookingAttachment(db, row);
    await logAttachment(event, ctx, 'attachment_remove', { attachmentId: row.id, bookingCode: booking.booking_code, fileName: row.file_name });
    return json({ ok: true }, { headers: PORTAL_HEADERS });
  } catch (e) {
    return attachmentApiError(e);
  }
};
