// 環境まわりの ambient（global）型宣言。
// app.d.ts は `import type { SessionUser }` を持つためモジュール扱いになり、そこに書いた
// トップレベル宣言は global にならない。global/ambient が必要な型は import を持たない本ファイルに置く。

// Cloudflare KV の最小型宣言（@cloudflare/workers-types 未導入環境向け）。
// アプリ設定フラグの読み書きに使う分だけ定義する。
interface KVNamespace {
	get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
	put(key: string, value: string): Promise<void>;
}

// async_hooks は Node.js 組み込みモジュール。@types/node 未インストール環境向けの最小型宣言。
// paraglide が生成する server.js で動的インポートされる。
declare module 'async_hooks' {
	export class AsyncLocalStorage<T> {
		run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R;
		getStore(): T | undefined;
		enterWith(store: T): void;
		disable(): void;
	}
}
