import type { SessionUser } from '$lib/server/session';

// Cloudflare KV の最小型宣言（@cloudflare/workers-types 未導入環境向け）。
// アプリ設定フラグの読み書きに使う分だけ定義する。
interface KVNamespace {
	get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
	put(key: string, value: string): Promise<void>;
}

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
			// OTP 認証は済んだが book.members 未登録のユーザー（/auth/register のプロフィール入力で使う）。
			// AUTH_MODE=supabase のときのみ設定される。
			pendingAuthUser: { id: string; email: string } | null;
		}
		// adapter-cloudflare が渡す実行環境。dev（vite）では undefined。
		interface Platform {
			env?: {
				AB_CONFIG?: KVNamespace;
			};
		}
	}
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

export {};
