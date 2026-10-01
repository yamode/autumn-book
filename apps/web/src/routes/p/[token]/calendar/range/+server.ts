// 料金カレンダー上部の「公開期間の料金」（1名1泊の最低〜最高）。公開範囲全体を読むので重く、
// カレンダー本体の表示を遅らせないよう画面からあとで取りに来る（結果は isolate 内で10分使い回す）。
import { json } from '@sveltejs/kit';
import { loadPartnerPriceRange } from '$lib/server/partners/rates';
import { PORTAL_HEADERS, requirePortalApi } from '$lib/server/partners/portal';

export const GET = async (event) => {
  const { db, partner } = await requirePortalApi(event);
  try {
    const range = await loadPartnerPriceRange(db, partner);
    return json(range ? { min: range.min, max: range.max, from: range.from, to: range.to } : { range: null }, { headers: PORTAL_HEADERS });
  } catch {
    // 読めないときは出さない（画面はカードを非表示にする）
    return json({ range: null }, { status: 503, headers: PORTAL_HEADERS });
  }
};
