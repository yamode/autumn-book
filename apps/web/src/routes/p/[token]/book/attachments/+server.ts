// 予約入力（/p/[token]/book）の添付ファイル: 1ファイルずつ仮置きする（§6.1）。
// 予約はまだ無いので partner_booking_id = null・このログインIDの仮置きとして保存し、id を返す。
// 画面は id を hidden の attachment_ids に積み、確定（/book の default・/book/reserve）で rms_partner_create_booking が結ぶ。
// 結ばれなかった仮置きは掃除の cron が 24 時間後に消す。
import { error, json } from '@sveltejs/kit';
import { isPartnerBookingOpen } from '$lib/server/partners/booking';
import { rejectOversizedUpload, uploadBookingAttachment } from '$lib/server/partners/booking-attachments';
import { PORTAL_HEADERS } from '$lib/server/partners/portal';
import { attachmentApiError, logAttachment, portalAttachmentView, requireAttachmentApi } from '$lib/server/partners/portal-attachments';

export const POST = async (event) => {
  const ctx = await requireAttachmentApi(event);
  const { db, partner, session } = ctx;
  if (!isPartnerBookingOpen(partner)) throw error(403, '現在ご予約を受け付けていません。');
  const tooLarge = rejectOversizedUpload(event.request, PORTAL_HEADERS);
  if (tooLarge) return tooLarge;
  const fd = await event.request.formData().catch(() => null);
  const file = fd?.get('file');
  if (!(file instanceof File) || file.size === 0) return json({ ok: false, message: 'ファイルを選んでください。' }, { status: 400, headers: PORTAL_HEADERS });
  try {
    const target = { stagedFor: session.id };
    const row = await uploadBookingAttachment(db, partner, file, { kind: 'partner', accountId: session.id, label: session.login_id }, target);
    await logAttachment(event, ctx, 'attachment_add', { attachmentId: row.id, fileName: row.file_name, bytes: row.byte_size, staged: true });
    return json({ ok: true, attachment: portalAttachmentView(event.params.token, target, row, session, true) }, { headers: PORTAL_HEADERS });
  } catch (e) {
    return attachmentApiError(e);
  }
};
