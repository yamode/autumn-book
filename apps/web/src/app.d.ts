import type { SessionUser } from '$lib/server/session';

// KVNamespace は ambient.d.ts で global 宣言（本ファイルは import を持ちモジュール化するため
// ここに書くと global にならない）。App.Platform からはその global 型を参照する。

declare global {
	// vite.config.ts の define で注入されるアプリバージョン（ルート package.json の version）
	const __APP_VERSION__: string;

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

export {};
