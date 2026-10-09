// 料金カレンダー上部の「公開期間の料金」（1名1泊の最低〜最高）。公開範囲全体を読むので重く、
// カードの表示を遅らせないよう画面からあとで取りに来る（結果は isolate 内で10分使い回す）。
// v0.77.0 で一度消し、2026-10-09 に復活（docs/partner-rank-rates.md §5.2）。選んでいる施設（requirePortalApi が合成した
// partner.facility_id・pricing）の幅を返す。キャッシュのキーにも施設を含める（rates.ts）。
import { json } from '@sveltejs/kit';
import { loadPartnerPriceRange } from '$lib/server/partners/rates';
import { PORTAL_HEADERS, requirePortalApi } from '$lib/server/partners/portal';

export const GET = async (event) => {
  const { db, partner } = await requirePortalApi(event);
  // オンの施設が無い取引先（N9）は出さない
  if (!partner.facility_available) return json({ range: null }, { headers: PORTAL_HEADERS });
  try {
    const range = await loadPartnerPriceRange(db, partner);
    // min / max は { price, count, samples[{date, roomName, planCode, planName, guests}] }（ツールチップの根拠）
    return json(range ? { min: range.min, max: range.max, from: range.from, to: range.to } : { range: null }, { headers: PORTAL_HEADERS });
  } catch {
    // 読めないときは出さない（画面はカードを非表示にする）
    return json({ range: null }, { status: 503, headers: PORTAL_HEADERS });
  }
};
