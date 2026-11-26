// 公開情報（施設・客室・支払設定・紹介文テンプレート・グレード別のキャンセル規定・参考最低料金）の短命キャッシュ。
// 入れ物は既存の TtlCache（ttl-cache.ts・2026-10-18 管理画面の高速化で入れたもの）をそのまま使う。
//
// なぜ要るか: Book は Supabase を supabase-js（PostgREST）で読むので、1 クエリ＝1 本の HTTPS 往復になる。
//   同じデータセンターの Postgres なら 1 往復 1ms 以下だが、ここは Cloudflare のエッジ → ap-northeast-1 で
//   現実に 1 往復 20〜60ms かかる。プラン詳細のように「滅多に変わらない設定」を何本も読むページでは、
//   その往復がそのままページの待ち時間になり、同時アクセスが増えると DB を掴んでいる時間も伸びる。
//
// ★ 覚えるのは **読み終わった値だけ**（2026-11-27 変更）。
//   以前は読み込み途中の Promise を覚えて、同時に来た別のリクエストもそれに相乗りさせていた。
//   Cloudflare Workers では、あるリクエストが作った Promise を別のリクエストで待つと、作ったほうのリクエストが
//   先に終わった時点で「This promise was created by a request that has since ended, so it can never settle」になり、
//   相乗りしたほうが 500 になる（デプロイ直後の空のキャッシュに同時アクセスが重なったとき・Sentry AUTUMN-BOOK-D）。
//   なので同時に来たときは、それぞれが自分で読みに行く（DB への往復は一時的に増えるが、読み終わった値は皆で使う）。
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

/** 読み終わった値（undefined も値として覚えられるよう箱に入れる） */
type Settled = { value: unknown };

/** TtlCache は寿命を作るときに決めるので、寿命ごとに 1 つ持つ（実運用では 60 秒と 30 秒の 2 つだけ） */
const caches = new Map<number, TtlCache<Settled>>();
function cacheFor(ttlMs: number): TtlCache<Settled> {
	let c = caches.get(ttlMs);
	if (!c) {
		c = new TtlCache<Settled>(ttlMs, 200);
		caches.set(ttlMs, c);
	}
	return c;
}

/**
 * key ごとに load() の結果を ttlMs のあいだ使い回す。
 * - 覚えるのは読み終わった値だけ（読み込み途中の Promise は別のリクエストと分け合わない・上の ★）。
 * - 失敗は覚えない（次の人がやり直せる）。
 */
export async function cachedPublic<T>(key: string, load: () => Promise<T>, ttlMs: number = PUBLIC_CACHE_TTL_MS): Promise<T> {
	const cache = cacheFor(ttlMs);
	const hit = cache.get(key);
	if (hit) return hit.value as T;
	const value = await load();
	cache.set(key, { value });
	return value;
}

/** テスト用。キャッシュを空にする */
export function clearPublicCache() {
	for (const c of caches.values()) c.clear();
}
