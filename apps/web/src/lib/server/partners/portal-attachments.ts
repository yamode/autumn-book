// 取引先ページ（/p/<token>）の添付ファイル API の共通処理（2026-10-07・設計 docs/partner-booking-attachments.md §6.1・§6.2・§9）。
//
// 入口は必ず requirePortalApi（未ログイン 401・公開停止 403・確認モードは GET 以外 403）。
// 予約は partner_id 条件つきで引き、添付は id ＋ partner_id ＋ 添付先の3条件で引く（別の取引先の id は 404）。
// PARTNER_BOOKING_ATTACHMENTS が off のあいだは 404（画面にも出さない）。
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { partnerCanDeleteAttachment } from '$lib/partner-attachments';
import {
  attachmentView,
  bookingAttachmentPolicy,
  getAttachmentBooking,
  partnerBookingAttachmentsEnabled,
  type AttachmentTarget,
  type BookingAttachmentRow
} from './booking-attachments';
import { PORTAL_HEADERS, requestMeta, requirePortalApi } from './portal';
import { logPartnerAccess, PartnerStoreError } from './store';

type PortalEvent = Pick<RequestEvent, 'params' | 'cookies' | 'request'>;

/** 入口: 機能の有効化 → 取引先ページの API の検証 */
export async function requireAttachmentApi(event: PortalEvent) {
  if (!partnerBookingAttachmentsEnabled()) throw error(404, 'ページが見つかりません。');
  return requirePortalApi(event);
}

/** 予約一覧の添付 API: 予約を partner_id 条件つきで引く（無ければ 404） */
export async function requireAttachmentBooking(event: PortalEvent) {
  const ctx = await requireAttachmentApi(event);
  const booking = await getAttachmentBooking(ctx.db, ctx.partner.id, event.params.id ?? '');
  if (!booking) throw error(404, 'ご予約が見つかりません。');
  return { ...ctx, booking, policy: bookingAttachmentPolicy(booking) };
}

/** JSON の失敗応答（PartnerStoreError は理由をそのまま・それ以外は投げ直す） */
export function attachmentApiError(e: unknown): Response {
  if (e instanceof PartnerStoreError) {
    return json({ ok: false, message: e.message }, { status: e.status >= 400 && e.status < 600 ? e.status : 400, headers: PORTAL_HEADERS });
  }
  throw e;
}

/** 取引先ページに渡す添付の形（ダウンロード URL・取引先が消せるか） */
export function portalAttachmentView(
  token: string,
  target: AttachmentTarget,
  r: BookingAttachmentRow,
  session: { id: string; is_master?: boolean; preview?: boolean },
  canDeleteByState: boolean
) {
  const base = 'bookingId' in target ? `/p/${token}/bookings/${target.bookingId}/attachments` : `/p/${token}/book/attachments`;
  return attachmentView(r, {
    href: `${base}/${r.id}`,
    // 確認モードは見るだけ。仮置きは自分のものしか引けないので常に消せる
    canDelete: !session.preview && canDeleteByState && ('stagedFor' in target || partnerCanDeleteAttachment(r, session)),
    audience: 'partner'
  });
}

/** アクセスログ（添付の追加・削除。確認モードは logPartnerAccess が記録しない） */
export async function logAttachment(
  event: PortalEvent,
  ctx: { db: Parameters<typeof logPartnerAccess>[0]; partner: { id: string }; session: { id: string } },
  action: 'attachment_add' | 'attachment_remove',
  detail: Record<string, unknown>
) {
  await logPartnerAccess(ctx.db, {
    partnerId: ctx.partner.id,
    accountId: ctx.session.id,
    channel: 'web',
    action,
    detail,
    ip: requestMeta(event as Pick<RequestEvent, 'request'>).ip
  });
}
