// 予約管理の詳細（取引先予約）: スタッフの添付ファイルの追加・削除を宿（PMS）へ知らせる（画面が一区切りで1回）。
// 通知の「誰が」はスタッフ名（by_kind: staff）。PMS へまだ送っていない予約・変化の無い予約には電文を出さない。
import { json } from '@sveltejs/kit';
import { notifyBookingAttachments } from '$lib/server/partners/booking-attachments';
import { partnerAttachmentApiError, partnerAttachmentTarget } from '$lib/server/partners/admin-reservations';

export const POST = async (event) => {
  try {
    const { db, row, staff } = await partnerAttachmentTarget(event, event.params.code);
    const body = (await event.request.json().catch(() => ({}))) as { added?: unknown; removed?: unknown };
    const r = await notifyBookingAttachments(db, row.id, body, { kind: 'staff', label: staff.label });
    return json({ ok: true, sent: r.sent });
  } catch (e) {
    return partnerAttachmentApiError(e);
  }
};
