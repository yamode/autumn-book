import { loadStayPage } from '$lib/server/partners/stay-page';

// 取引先専用ページ: 料金カレンダー（2026-10-06 に一休型の「お部屋とプラン」へ一本化）。部屋タイプごとのカード。
// 読み込みはプランのご紹介（プランごとのカード）と共通。
export const load = (event) => loadStayPage(event, 'calendar');
