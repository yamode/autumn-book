// 回数制限に使う「接続元」のキー（2026-11-23 セキュリティレビュー H-2）。
//
// IPv6 は 1 回線に /64（2^64 個のアドレス）が割り当てられるのが普通で、
// フルアドレスで数えると、アドレスを替え続けるだけで回数制限をすり抜けられる。
// そこで IPv6 は先頭 64 ビット（/64）に丸めて 1 つの接続元として数える。
// IPv4 と IPv4 射影アドレス（::ffff:1.2.3.4）は IPv4 のまま。読めない値はそのまま返す。

/** IPv6 を 8 つの 16 ビット区切り（小文字・4 桁）に展開する。読めなければ null。 */
function expandIpv6(addr: string): string[] | null {
	let s = addr.toLowerCase();
	const zone = s.indexOf('%');
	if (zone >= 0) s = s.slice(0, zone);
	// 末尾が IPv4 表記（::ffff:1.2.3.4 など）なら 2 区切りに直す
	const v4 = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (v4) {
		const o = v4.slice(2, 6).map(Number);
		if (o.some((n) => n > 255)) return null;
		s = v4[1] + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
	}
	const halves = s.split('::');
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(':') : [];
	const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
	if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
	const groups = [...head, ...Array(fill).fill('0'), ...tail];
	if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
	return groups.map((g) => g.padStart(4, '0'));
}

/** 回数制限のキーにする接続元。IPv6 は /64 に丸める。 */
export function rateLimitClientKey(addr: string | null | undefined): string {
	const a = (addr ?? '').trim();
	if (!a.includes(':')) return a;
	const g = expandIpv6(a);
	if (!g) return a;
	// IPv4 射影（::ffff:a.b.c.d）は IPv4 として扱う
	if (g.slice(0, 5).every((x) => x === '0000') && g[5] === 'ffff') {
		const n = [g[6], g[7]].map((x) => parseInt(x, 16));
		return [n[0] >> 8, n[0] & 255, n[1] >> 8, n[1] & 255].join('.');
	}
	return g.slice(0, 4).join(':') + '::/64';
}
