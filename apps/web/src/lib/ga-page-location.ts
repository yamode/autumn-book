// GA4 に送る page_location を作る純関数。
// 予約コード・トークン・検索条件は送らない。流入元の計測に要る utm_* だけ残す
// （施設 HP からの遷移を utm_source=hp_* で見るため・docs/hp-book-integration.md §3.5）。

/** GA4 に送ってよいクエリ（utm_* のみ）。 */
function isUtmKey(key: string): boolean {
	return /^utm_[a-z0-9_]+$/i.test(key);
}

export function gaPageLocation(origin: string, pathname: string, search: string): string {
	const safePath = pathname
		.replace(/(\/booking\/complete\/)[^/]+/, '$1:code')
		.replace(/(\/account\/reservations\/)[^/]+/, '$1:code');
	const kept = new URLSearchParams();
	for (const [key, value] of new URLSearchParams(search)) {
		if (isUtmKey(key)) kept.append(key, value);
	}
	const query = kept.toString();
	return `${origin}${safePath}${query ? `?${query}` : ''}`;
}
