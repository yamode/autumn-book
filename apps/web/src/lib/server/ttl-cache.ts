// 短い時間だけ覚えておく入れ物（2026-10-18 管理画面の高速化）。
// Cloudflare Workers の isolate（同じ実行環境）の中だけで効く。別の isolate では最初から読み直す＝ずれは最大でも ttl まで。
// 画面遷移のたびに同じ問い合わせ（ログインの確認・パスキーの状態・メンテナンス・団体照会の件数）を繰り返さないために使う。

type Entry<T> = { value: T; expires: number };

export class TtlCache<T> {
	private map = new Map<string, Entry<T>>();
	constructor(
		private readonly ttlMs: number,
		private readonly max = 500
	) {}

	get(key: string, now = Date.now()): T | undefined {
		const e = this.map.get(key);
		if (!e) return undefined;
		if (e.expires <= now) {
			this.map.delete(key);
			return undefined;
		}
		return e.value;
	}

	set(key: string, value: T, now = Date.now()): void {
		// 増えすぎたら古い順に捨てる（Map は入れた順）
		if (this.map.size >= this.max) {
			const first = this.map.keys().next().value;
			if (first !== undefined) this.map.delete(first);
		}
		this.map.set(key, { value, expires: now + this.ttlMs });
	}

	delete(key: string): void {
		this.map.delete(key);
	}

	clear(): void {
		this.map.clear();
	}
}
