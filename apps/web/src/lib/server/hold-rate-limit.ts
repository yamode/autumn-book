// 公式サイトの仮押さえ（book.create_hold）の接続元ごとの回数制限（auth-hardening.md §9・S8）。
//
// ■ 二段構え
//   1. ここ（KV `AB_RATE`）: `hold:<ip>` を 10 分の固定窓で 20 回まで。DB に届く前に止める。
//   2. DB（autumn-shared 20261009210747）: create_hold が p_client_key（同じ IP）で 10 分 20 件・全体 10 分 500 件。
//      KV は結果整合で取りこぼしがあり、isolate をまたぐ同時要求も漏れうるので、最後の歯止めは DB 側。
//
// ■ KV が無い環境（vite dev・vitest）はプロセス内メモリに落ちる。KV の障害時は通す（お客様を締め出さない側に倒す。
//   DB 側の上限が残る）。
// Turnstile は別途（S2 の lib/server/turnstile.ts）で足す。

type Platform = App.Platform | undefined;

type KvLike = {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

/** 同じ接続元から 10 分に何回まで仮押さえを試せるか（DB 側の上限と同じ値） */
export const HOLD_LIMIT = 20;
/** 窓の長さ（秒） */
export const HOLD_WINDOW_SEC = 10 * 60;

/** KV のキー（固定窓）。ip は 100 文字で切る（DB の client_key と同じ） */
export function holdRateKey(ip: string, nowMs: number, windowSec = HOLD_WINDOW_SEC): string {
	return `hold:${holdClientKey(ip)}:${Math.floor(nowMs / 1000 / windowSec)}`;
}

/** DB に渡す接続元（空なら 'unknown'・100 文字まで） */
export function holdClientKey(ip: string | null | undefined): string {
	const v = (ip ?? '').trim();
	return (v === '' ? 'unknown' : v).slice(0, 100);
}

/** すでに count 回試した接続元に、もう 1 回試させてよいか */
export function holdAllowed(count: number, limit = HOLD_LIMIT): boolean {
	return count < limit;
}

/** create_hold の例外メッセージを画面の分岐に使う種類へ */
export function holdErrorKind(message: string | null | undefined): 'sold_out' | 'rate_limited' | 'too_many_holds' | null {
	const m = message ?? '';
	if (m.includes('rate_limited')) return 'rate_limited';
	if (m.includes('too_many_holds')) return 'too_many_holds';
	if (m.includes('sold_out')) return 'sold_out';
	return null;
}

const memory = new Map<string, number>();

function kv(platform: Platform): KvLike | null {
	return (platform?.env?.AB_RATE as unknown as KvLike | undefined) ?? null;
}

/**
 * 仮押さえを 1 回試す前に呼ぶ。上限内なら数えて true、超えていれば false。
 */
export async function holdRateCheck(platform: Platform, ip: string, nowMs = Date.now()): Promise<boolean> {
	const key = holdRateKey(ip, nowMs);
	const ns = kv(platform);
	if (!ns) {
		const n = memory.get(key) ?? 0;
		if (!holdAllowed(n)) return false;
		memory.set(key, n + 1);
		// 古い窓を掃除（メモリが増え続けないように）
		if (memory.size > 1000) memory.clear();
		return true;
	}
	try {
		const n = parseInt((await ns.get(key)) ?? '0', 10) || 0;
		if (!holdAllowed(n)) return false;
		await ns.put(key, String(n + 1), { expirationTtl: Math.max(60, HOLD_WINDOW_SEC * 2) });
	} catch (e) {
		console.error('[hold-rate-limit]', e instanceof Error ? e.message : String(e));
	}
	return true;
}
