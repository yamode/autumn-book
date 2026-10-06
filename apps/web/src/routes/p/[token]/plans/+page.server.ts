import { loadStayPage } from '$lib/server/partners/stay-page';

// 取引先専用ページ: プランのご紹介（2026-10-07 に一休型へ）。プランごとに、選べる部屋タイプと料金をカードにまとめ、
// 「詳細・予約」でプラン詳細のモーダルを開く。読み込みは料金カレンダーと共通。
export const load = (event) => loadStayPage(event, 'plans');
