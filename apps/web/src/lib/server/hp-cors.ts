// 施設 HP（Xserver 配信）からブラウザが直接呼ぶ API の CORS。許可するのは両 HP のホストだけ。
// 使う API: /api/geo（同意バナーの出し分け）・/api/stay-calendar（検索バー embed/search-bar.js の空き日）。
const ALLOWED_ORIGINS = new Set(['https://www.yamado.co.jp', 'https://yamado.co.jp', 'https://oga.yamado.co.jp']);

export function isHpOrigin(origin: string | null): boolean {
	return !!origin && ALLOWED_ORIGINS.has(origin);
}

/** CORS ヘッダ。許可外のオリジンには Access-Control-* を付けない（Vary: Origin は常に付ける）。 */
export function hpCorsHeaders(origin: string | null, extra: Record<string, string> = {}): Record<string, string> {
	const h: Record<string, string> = { ...extra, Vary: 'Origin' };
	if (origin && isHpOrigin(origin)) {
		h['Access-Control-Allow-Origin'] = origin;
		h['Access-Control-Allow-Methods'] = 'GET';
	}
	return h;
}
