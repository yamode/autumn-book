// 取引先ページ: 団体予約の照会の一括送信（JSON・docs/partner-group-booking.md §8.1）。
// 入力: { items: GroupDraftItem[] }（lib/partner-group.ts）。1件でも誤りがあれば全件送らない（部分送信にしない）。
// 出力: 200 { ok: true, batchId, inquiries: [{id, inquiryCode, quoteStatus}], warnings }
//       400 { ok: false, message, errors: [{index, message}], warnings }（index は items の添字・-1 は全体）
//       401（未ログイン）/ 403（公開停止・確認モード・本人確認待ち）/ 404（団体予約を使えない取引先）
import { error, json } from '@sveltejs/kit';
import { groupInquiryAvailable } from '$lib/partner-group';
import { groupFormCatalog, submitGroupBatch } from '$lib/server/partners/group-inquiries';
import { PartnerStoreError } from '$lib/server/partners/store';
import { portalFacilityContext, PORTAL_HEADERS, requestMeta, requirePortalApi } from '$lib/server/partners/portal';

export const POST = async (event) => {
  const { db, partner, session } = await requirePortalApi(event);
  if (!groupInquiryAvailable(partner)) throw error(404, 'ページが見つかりません。');
  const body = (await event.request.json().catch(() => null)) as { items?: unknown } | null;
  const items = Array.isArray(body?.items) ? body.items : [];
  try {
    const result = await submitGroupBatch(
      db,
      partner,
      { id: session.id, login_id: session.login_id },
      items,
      { ip: requestMeta(event).ip, origin: event.url.origin },
      (facilityId) => portalFacilityContext(db, partner, facilityId),
      // 部屋タイプ × プランは入力画面の選択肢と同じもの（取引先に売っているもの）だけ
      (ctx) => groupFormCatalog(event, db, ctx)
    );
    return json(result, { status: result.ok ? 200 : 400, headers: PORTAL_HEADERS });
  } catch (e) {
    if (e instanceof PartnerStoreError) {
      return json({ ok: false, message: e.message, errors: [{ index: -1, message: e.message }], warnings: [] }, { status: e.status, headers: PORTAL_HEADERS });
    }
    throw e;
  }
};
