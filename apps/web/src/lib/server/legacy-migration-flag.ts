// 旧会員（tripla）の会員移行の入口を開くか（2026-11-19）。
// 開くときは本番の環境変数 LEGACY_MEMBER_MIGRATION=true（wrangler.jsonc の vars）にする。
// 閉じている間は /auth/migrate は「準備中」、ログイン・会員登録画面・マイページのリンクも出さない。
// 開くのは本番ドメイン（book.yamado.app）と開発中の手元だけ。プレビュー・旧ドメインでは常に閉じる。
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { AUTH_MODE } from '$lib/server/auth';

/** 案内メールのリンク・完了通知に使うサイトの起点（Host ヘッダは信用しない・OWASP） */
export const MIGRATION_SITE_ORIGIN = 'https://book.yamado.app';

export function legacyMigrationOpen(url?: URL): boolean {
	if (AUTH_MODE !== 'supabase' || env.LEGACY_MEMBER_MIGRATION !== 'true') return false;
	// 開いてよいのは本番ドメインと開発中の手元だけ（許可リスト。プレビュー・旧ドメインでは閉じる）
	if (!url) return false;
	return dev || url.hostname === new URL(MIGRATION_SITE_ORIGIN).hostname;
}

/** 案内メールに載せる起点。開発中だけ手元のアドレス */
export function migrationOrigin(url: URL): string {
	return dev ? url.origin : MIGRATION_SITE_ORIGIN;
}
