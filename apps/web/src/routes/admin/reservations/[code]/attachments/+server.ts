// 予約管理の詳細（取引先予約）: スタッフが添付ファイルを追加する（1リクエスト1ファイル・§6.4）。
// 入口は partnerAttachmentTarget（ログイン中スタッフの施設アクセス＋台帳と取引先の所属）。PMS への反映は ./notify。
import { json } from '@sveltejs/kit';
import { attachmentView, rejectOversizedUpload, uploadBookingAttachment } from '$lib/server/partners/booking-attachments';
import { partnerAttachmentApiError, partnerAttachmentTarget } from '$lib/server/partners/admin-reservations';
import { PartnerStoreError } from '$lib/server/partners/store';

export const POST = async (event) => {
  try {
    const { db, partner, row, policy, staff } = await partnerAttachmentTarget(event, event.params.code);
    if (!policy.canAdd) throw new PartnerStoreError(policy.note ?? 'この予約には添付ファイルを追加できません。');
    const tooLarge = rejectOversizedUpload(event.request);
    if (tooLarge) return tooLarge;
    const fd = await event.request.formData().catch(() => null);
    const file = fd?.get('file');
    if (!(file instanceof File) || file.size === 0) throw new PartnerStoreError('ファイルを選んでください。');
    const att = await uploadBookingAttachment(db, partner, file, { kind: 'staff', userId: staff.userId, label: staff.label }, { bookingId: row.id });
    return json({
      ok: true,
      attachment: attachmentView(att, {
        href: `/admin/reservations/${encodeURIComponent(event.params.code)}/attachments/${att.id}`,
        canDelete: policy.canDelete,
        audience: 'staff'
      })
    });
  } catch (e) {
    return partnerAttachmentApiError(e);
  }
};
