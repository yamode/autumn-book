// 公開ページの検索掲載開始時刻（日本時間）。
export const SEARCH_INDEXING_START = Date.parse('2026-11-30T00:00:00+09:00');
export const NOINDEX_META = '<meta name="robots" content="noindex,nofollow" />';

// 通常の公開ページのみ。予約手続き・限定プラン・ログイン・管理画面などはここに含めない。
const publicRoutes = new Set([
	'/(public)',
	'/(public)/membership',
	'/(public)/help',
	'/(public)/legal/[page]',
	'/(public)/kitakaze',
	'/(public)/community',
	'/(public)/community/[board]',
	'/(public)/community/threads/[id]',
	'/(public)/[brand]/[facility]',
	'/(public)/[brand]/[facility]/plans',
	'/(public)/[brand]/[facility]/rooms',
	'/(public)/[brand]/[facility]/rooms/[room]',
	'/(public)/[brand]/[facility]/news',
	'/(public)/[brand]/[facility]/news/[id]'
]);

export function isPublicSearchPage(routeId: string | null): boolean {
	return routeId !== null && publicRoutes.has(routeId);
}

export function allowSearchIndexing(isPublicPage: boolean, now: number): boolean {
	return isPublicPage && now >= SEARCH_INDEXING_START;
}
