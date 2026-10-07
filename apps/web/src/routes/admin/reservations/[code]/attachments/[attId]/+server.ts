// 予約管理の詳細（取引先予約）の添付ファイル1件: ダウンロード（GET）と削除（DELETE・スタッフはどのファイルも消せる）。
import { error, json } from '@sveltejs/kit';
import { documentResponse } from '$lib/server/partners/memorandum';
import { deleteBookingAttachment, downloadBookingAttachment, getBookingAttachment } from '$lib/server/partners/booking-attachments';
import { partnerAttachmentApiError, partnerAttachmentTarget } from '$lib/server/partners/admin-reservations';
import { PartnerStoreError } from '$lib/server/partners/store';
import { StaffScopeError } from '$lib/server/partners/staff';

export const GET = async (event) => {
  let found;
  try {
    const { db, partner, row } = await partnerAttachmentTarget(event, event.params.code);
    found = await downloadBookingAttachment(db, partner.id, event.params.attId, { bookingId: row.id });
  } catch (e) {
    if (e instanceof StaffScopeError || e instanceof PartnerStoreError) throw error(e.status >= 400 && e.status < 600 ? e.status : 400, e.message);
    throw e;
  }
  if (!found) throw error(404, 'ファイルが見つかりません。');
  return documentResponse(found.row, found.body);
};

export const DELETE = async (event) => {
  try {
    const { db, partner, row, policy } = await partnerAttachmentTarget(event, event.params.code);
    const att = await getBookingAttachment(db, partner.id, event.params.attId, { bookingId: row.id });
    if (!att) throw new PartnerStoreError('ファイルが見つかりません。', 404);
    if (!policy.canDelete) throw new PartnerStoreError(policy.note ?? 'この予約の添付ファイルは削除できません。');
    await deleteBookingAttachment(db, att);
    return json({ ok: true });
  } catch (e) {
    return partnerAttachmentApiError(e);
  }
};
