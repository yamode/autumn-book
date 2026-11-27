import type { SessionUser } from '$lib/server/session';
import type { ExperimentAssignment } from '$lib/experiments';
import type { AdminAal } from '$lib/admin-mfa';

// KVNamespace は ambient.d.ts で global 宣言（本ファイルは import を持ちモジュール化するため
// ここに書くと global にならない）。App.Platform からはその global 型を参照する。

declare global {
	// vite.config.ts の define で注入されるアプリバージョン（ルート package.json の version）
	const __APP_VERSION__: string;

	namespace App {
		interface PageState {
			planDetail?: string;
			depth?: number;
			privateBookSpecialOnly?: boolean;
		}
		interface Locals {
			user: SessionUser | null;
			abExperiments: ExperimentAssignment[];
			// OTP 認証は済んだが book.members 未登録のユーザー（/auth/register のプロフィール入力で使う）。
			// AUTH_MODE=supabase のときのみ設定される。
			pendingAuthUser: { id: string; email: string } | null;
			// 管理者/スタッフのセッションの認証レベル（二段階認証の関所・docs/auth-hardening.md §7.2）。
			// AUTH_MODE=supabase で admin / staff のときのみ設定。demo・会員・未ログインは null。
			adminAal: AdminAal | null;
			memberMfaPending?: { id: string; unavailable: boolean };
			// 管理画面にログインしている運営（admin / staff）。公開サイトでも、管理画面の cookie から読む（2026-11-22）。
			// 同じブラウザでマイページに会員でログインしていると user は会員になるので、プランのプレビュー・メンテナンスの通り抜け・
			// 客室案内のテスト決済など「運営かどうか」はこちらで見る（staffOf）。
			staff?: { user: SessionUser; adminAal: AdminAal | null } | null;
			// ログインの確認にかかった時間（ミリ秒・管理画面の Server-Timing に出す）
			authMs?: number;
			memberPreview?: import('$lib/plan-access').RankCode;
			// Autumn Live の入場券（/live 配下だけ・hooks.server.ts handleLive）。docs/autumn-live.md §4.4
			live?: import('$lib/live-pass').LivePass | null;
			// プライベートブック（特別会員を公式サイトの中で扱う・docs/private-book.md）の状態。hooks で 1 回だけ入れる。
			// クッキー ab_private_book は信じず、resolvePrivateBook が会員ログイン・ページを使えるか・公開期間を確かめた結果。
			// 料金を差し替える・束を作るときは、これに加えて施設ごとの判定（privateBookFacility）と、hold では確かめ直しをする
			privateBook?: import('$lib/private-book').PrivateBookState | null;
		}
		// adapter-cloudflare が渡す実行環境。dev（vite）では undefined。
		interface Platform {
			env?: {
				AI?: Env['AI'];
				AB_CONFIG?: KVNamespace;
				// FAQ ボット公開 API のレート制限（KV: autumn-book-rate）
				AB_RATE?: KVNamespace;
			};
			// 応答を返した後も処理を続ける（取引先の請求 cron が Stripe 呼び出しを逃がすのに使う）。
			context?: {
				waitUntil(promise: Promise<unknown>): void;
			};
		}
	}
}

export {};
