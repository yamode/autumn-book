import type { SessionUser } from '$lib/server/session';

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
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
