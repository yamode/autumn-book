// 取引先専用ページの中で見せる 特定商取引法に基づく表記・プライバシーポリシー・宿泊約款（2026-10-06）。
// 中身は公式サイトの /legal/[page] と同じ（lib/server/store.ts の getLegalPage）。特商法の表記だけ取引先向けの文面（lib/server/partners/legal.ts）。公式サイトはまだ非公開（メンテナンス中）なので、
// 取引先ページの見た目のまま、この中で表示する。フッターはログイン前の画面にも出るので、ログインしていなくても読める。
import { error } from '@sveltejs/kit';
import { getLegalPage } from '$lib/server/store';
import { portalHeader, PORTAL_HEADERS, resolvePortal } from '$lib/server/partners/portal';
import { partnerTokushoho } from '$lib/server/partners/legal';
import { loadCancelAdminFeePercent } from '$lib/server/payment-settings';

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { partner, session } = await resolvePortal(event);
  // 宿泊約款は正式な文面ができるまで出さない（2026-10-06 指示）
  if (event.params.page === 'yakkan') throw error(404, 'ページが見つかりません。');
  // 特商法の表記は取引先向けの文面（支払方法・期限はこの取引先の設定から）。ほかの2つは公式サイトと同じ
  const doc =
    event.params.page === 'tokushoho'
      ? partnerTokushoho(partner, await loadCancelAdminFeePercent(partner.facility_id))
      : getLegalPage(event.params.page, 'ja');
  if (!doc) throw error(404, 'ページが見つかりません。');
  return { portal: portalHeader(partner, session), doc };
};
