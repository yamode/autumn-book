// 取引先専用ページの中で見せる 特定商取引法に基づく表記・プライバシーポリシー・宿泊約款（2026-10-06）。
// 中身は公式サイトの /legal/[page] と同じ（lib/server/store.ts の getLegalPage）。公式サイトはまだ非公開（メンテナンス中）なので、
// 取引先ページの見た目のまま、この中で表示する。フッターはログイン前の画面にも出るので、ログインしていなくても読める。
import { error } from '@sveltejs/kit';
import { getLegalPage } from '$lib/server/store';
import { portalHeader, PORTAL_HEADERS, resolvePortal } from '$lib/server/partners/portal';

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { partner, session } = await resolvePortal(event);
  const doc = getLegalPage(event.params.page, 'ja');
  if (!doc) throw error(404, 'ページが見つかりません。');
  return { portal: portalHeader(partner, session), doc };
};
