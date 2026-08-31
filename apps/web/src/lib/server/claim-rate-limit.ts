// 手入力コード（8桁）の試行レート制限。
//
// ■ なぜ作り直したか（貸切風呂の設計レビュー M1・2026-08-31）
//   これまでの実装（store.ts の claimRateCheck ほか）は **プロセス内 Map** だった。
//   Cloudflare Workers は isolate ごとにメモリが分かれ、しかも揮発する
//   ── つまり本番では「別の isolate に当たれば回数がリセットされる」ため、
//   総当たりを実質止められない。migration 側の claim_stay_by_code も
//   「試行制限はアプリ層で実施」と書いてあるだけで、DB では止めていない。
//
//   館内図に刷った QR は公開URLの入口で、そのフォールバックがこの8桁コード。
//   公開前にここを直しておかないと、8桁＝1億通りとはいえ、施設あたりの発行数が
//   増えるほど当たりやすくなる。
//
// ■ 何に置き換えたか
//   メンテナンストグルと同じ **KV（AB_CONFIG バインド）** に数える。
//   edge をまたいで共有・永続するので、isolate が変わっても回数が続く。
//   KV は結果整合なので厳密なカウンタにはならない（同時に走った数回は取りこぼす）が、
//   総当たりのような「多数回の試行」は確実に頭打ちになる。
//
//   KV バインドが無い環境（vite dev・テスト）は従来どおりプロセス内メモリに落ちる。
type Platform = App.Platform | undefined;

// 使うのは get / put だけ。プロジェクトの KVNamespace 型は expirationTtl 付きの put や
// delete を持たない版なので、必要な形だけを自前で書いて受ける。
type KvLike = {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

const PREFIX = 'claim_rate:';
/** 何回失敗したらロックするか。 */
const MAX_FAIL = 5;
/** ロックの長さ（秒）。KV の TTL 下限（60秒）以上であること。 */
const LOCK_SEC = 10 * 60;
/** 失敗回数を覚えておく長さ（秒）。ロックに至らない試行もこの間は積み上がる。 */
const WINDOW_SEC = 10 * 60;

type Record_ = { fails: number; lockedUntil: number };

// KV バインドが無い環境用のフォールバック（従来と同じ挙動）。
const memory = new Map<string, Record_>();

function kv(platform: Platform): KvLike | null {
	return (platform?.env?.AB_CONFIG as unknown as KvLike | undefined) ?? null;
}

async function read(platform: Platform, key: string): Promise<Record_ | null> {
	const ns = kv(platform);
	if (!ns) return memory.get(key) ?? null;
	try {
		const raw = await ns.get(PREFIX + key);
		return raw ? (JSON.parse(raw) as Record_) : null;
	} catch {
		return null; // KV が読めないときは通す（お客様を締め出さない側に倒す）
	}
}

async function write(platform: Platform, key: string, rec: Record_, ttlSec: number): Promise<void> {
	const ns = kv(platform);
	if (!ns) {
		memory.set(key, rec);
		return;
	}
	try {
		await ns.put(PREFIX + key, JSON.stringify(rec), { expirationTtl: Math.max(60, ttlSec) });
	} catch {
		/* 記録できなくても認証そのものは進める */
	}
}

/** ロック中か。locked=true なら残り秒 retryInSec を返す。 */
export async function claimRateCheck(
	platform: Platform,
	key: string
): Promise<{ locked: boolean; retryInSec: number }> {
	const rec = await read(platform, key);
	if (rec && rec.lockedUntil > Date.now()) {
		return { locked: true, retryInSec: Math.ceil((rec.lockedUntil - Date.now()) / 1000) };
	}
	return { locked: false, retryInSec: 0 };
}

/** 失敗を1回数える。MAX_FAIL に届いたらロックする。 */
export async function claimRecordFailure(platform: Platform, key: string): Promise<void> {
	const cur = (await read(platform, key)) ?? { fails: 0, lockedUntil: 0 };
	const next: Record_ = { fails: cur.fails + 1, lockedUntil: cur.lockedUntil };
	if (next.fails >= MAX_FAIL) {
		next.lockedUntil = Date.now() + LOCK_SEC * 1000;
		next.fails = 0;
	}
	await write(platform, key, next, next.lockedUntil > Date.now() ? LOCK_SEC : WINDOW_SEC);
}

/**
 * 成功したら数えをやめる。
 * KV では消すのではなく **空の記録を短い TTL で上書き**する（delete を使わずに済ませる）。
 */
export async function claimRecordSuccess(platform: Platform, key: string): Promise<void> {
	const ns = kv(platform);
	if (!ns) {
		memory.delete(key);
		return;
	}
	await write(platform, key, { fails: 0, lockedUntil: 0 }, 60);
}

/** KV に載っているか（本番で edge 間共有・永続が効くか）。管理画面の表示用。 */
export function isClaimRateDurable(platform: Platform): boolean {
	return Boolean(kv(platform));
}
