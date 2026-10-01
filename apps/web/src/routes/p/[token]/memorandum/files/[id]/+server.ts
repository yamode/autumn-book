// 覚書のファイルのダウンロード（取引先専用ページ）。本文はサーバが中継する（署名URLを外へ出さない）。
// ログイン中の取引先（partner.id）のファイルだけ。別の取引先のファイル id を渡されても 404。
import { error } from '@sveltejs/kit';
import { documentResponse, downloadPartnerDocument } from '$lib/server/partners/memorandum';
import { PORTAL_HEADERS, requirePortalSession } from '$lib/server/partners/portal';

export const GET = async (event) => {
  const { db, partner } = await requirePortalSession(event);
  let found;
  try {
    found = await downloadPartnerDocument(db, partner.id, event.params.id);
  } catch {
    throw error(503, 'ファイルを読み込めませんでした。時間をおいてお試しください。');
  }
  if (!found) throw error(404, 'ファイルが見つかりません。');
  return documentResponse(found.doc, found.body, PORTAL_HEADERS);
};
