// 予約入力の仮置きの添付: ダウンロード（GET）と取り消し（DELETE）。
// 引けるのはこのログインIDの未束縛の行だけ（予約に結ばれた後・他人の仮置きは 404）。
import { error, json } from '@sveltejs/kit';
import { documentResponse } from '$lib/server/partners/memorandum';
import { deleteBookingAttachment, downloadBookingAttachment, getBookingAttachment } from '$lib/server/partners/booking-attachments';
import { PORTAL_HEADERS } from '$lib/server/partners/portal';
import { attachmentApiError, logAttachment, requireAttachmentApi } from '$lib/server/partners/portal-attachments';

export const GET = async (event) => {
  const { db, partner, session } = await requireAttachmentApi(event);
  let found;
  try {
    found = await downloadBookingAttachment(db, partner.id, event.params.id, { stagedFor: session.id });
  } catch {
    throw error(503, 'ファイルを読み込めませんでした。時間をおいてお試しください。');
  }
  if (!found) throw error(404, 'ファイルが見つかりません。');
  return documentResponse(found.row, found.body, PORTAL_HEADERS);
};

export const DELETE = async (event) => {
  const ctx = await requireAttachmentApi(event);
  const { db, partner, session } = ctx;
  try {
    const row = await getBookingAttachment(db, partner.id, event.params.id, { stagedFor: session.id });
    if (!row) return json({ ok: false, message: 'ファイルが見つかりません。' }, { status: 404, headers: PORTAL_HEADERS });
    await deleteBookingAttachment(db, row);
    await logAttachment(event, ctx, 'attachment_remove', { attachmentId: row.id, fileName: row.file_name, staged: true });
    return json({ ok: true }, { headers: PORTAL_HEADERS });
  } catch (e) {
    return attachmentApiError(e);
  }
};
