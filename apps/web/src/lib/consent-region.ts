// アクセス解析の同意を先に聞く必要がある地域（2026-10-21 指示）。
// 欧州経済領域（EU 27 か国＋アイスランド・リヒテンシュタイン・ノルウェー）・英国・スイスは、
// GDPR 等により解析 Cookie の前に同意が要る。それ以外（日本など）は確認を出さずに計測し、
// プライバシーポリシーで公表したうえで「停止する」手段を残す。
// 国が分からない（情報なし・XX・Tor の T1 など）ときは安全側に倒して同意を聞く。
// hp-yamado も /api/geo 経由でこの判定を使う。
export const CONSENT_REQUIRED_COUNTRIES: ReadonlySet<string> = new Set([
	// EU 27 か国
	'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
	// EEA の EU 以外
	'IS', 'LI', 'NO',
	// 英国・スイス
	'GB', 'CH'
]);

/** その国からのアクセスで、解析の前に同意を聞く必要があるか（国が分からなければ true） */
export function consentRequiredFor(country: string | null | undefined): boolean {
	const c = (country ?? '').trim().toUpperCase();
	if (!/^[A-Z]{2}$/.test(c) || c === 'XX') return true;
	return CONSENT_REQUIRED_COUNTRIES.has(c);
}
