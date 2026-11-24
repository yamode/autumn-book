// 公開情報（施設・客室・支払設定・紹介文テンプレート・グレード別のキャンセル規定）の短命キャッシュ。
// 入れ物は既存の TtlCache（ttl-cache.ts・2026-10-18 管理画面の高速化で入れたもの）をそのまま使い、
// 公開ページ向けに 2 つだけ足している: ①同時に来たら 1 本だけ DB に行く ②失敗は覚えない。
//
// なぜ要るか: Book は Supabase を supabase-js（PostgREST）で読むので、1 クエリ＝1 本の HTTPS 往復になる。
//   同じデータセンターの Postgres なら 1 往復 1ms 以下だが、ここは Cloudflare のエッジ → ap-northeast-1 で
//   現実に 1 往復 20〜60ms かかる。プラン詳細のように「滅多に変わらない設定」を何本も読むページでは、
//   その往復がそのままページの待ち時間になり、同時アクセスが増えると DB を掴んでいる時間も伸びる。
//
// 入れてよいもの: 誰が見ても同じ公開データだけ。会員・スタッフ・閲覧者で変わるものは入れない
//   （お気に入り・my_profile・シークレットプランの可否などは対象外）。
//   管理画面の編集画面も対象外（保存した結果がすぐ見えないと困るので、直に読む）。
// 反映の遅れ: 管理画面で変えてから最大 TTL のあいだ古い値が出る。既定 60 秒、金額に関わる支払設定は 30 秒。
//   呼ぶ側はどれも DATA_SOURCE === 'supabase' の枝の中なので、デモ運用のローカル開発はここを通らない。
import { TtlCache } from './ttl-cache';

/** 既定の寿命（ミリ秒）。滅多に変わらない公開データ向け */
export const PUBLIC_CACHE_TTL_MS = 60_000;
/** 金額の表示に関わるもの（支払設定）は短くする */
export const PAYMENT_CACHE_TTL_MS = 30_000;

/** TtlCache は寿命を作るときに決めるので、寿命ごとに 1 つ持つ（実運用では 60 秒と 30 秒の 2 つだけ） */
const caches = new Map<number, TtlCache<Promise<unknown>>>();
function cacheFor(ttlMs: number): TtlCache<Promise<unknown>> {
	let c = caches.get(ttlMs);
	if (!c) {
		c = new TtlCache<Promise<unknown>>(ttlMs, 200);
		caches.set(ttlMs, c);
	}
	return c;
}

/**
 * key ごとに load() の結果を ttlMs のあいだ使い回す。
 * - 値ではなく Promise を覚えるので、同時に何人も来たときに DB へ行くのは最初の 1 本だけ（残りは相乗りする）。
 * - 失敗は覚えない（次の人がやり直せる）。
 */
export function cachedPublic<T>(key: string, load: () => Promise<T>, ttlMs: number = PUBLIC_CACHE_TTL_MS): Promise<T> {
	const cache = cacheFor(ttlMs);
	const hit = cache.get(key) as Promise<T> | undefined;
	if (hit) return hit;
	const p = load();
	cache.set(key, p);
	p.catch(() => {
		if (cache.get(key) === p) cache.delete(key);
	});
	return p;
}

/** テスト用。キャッシュを空にする */
export function clearPublicCache() {
	for (const c of caches.values()) c.clear();
}
