// ブックマークから滞在中いつでも戻れ、終了後も「滞在終了」を表示できるようにする。
// アクセス権は Cookie の有無ではなく stay_info RPC の valid_to で毎回判定する。
const THREE_DAYS = 60 * 60 * 24 * 3;

export function stayCookieMaxAge(validTo: string, now = Date.now()): number {
	const remaining = Math.ceil((Date.parse(validTo) - now) / 1000);
	return Number.isFinite(remaining) ? Math.max(THREE_DAYS, remaining + THREE_DAYS) : THREE_DAYS;
}
