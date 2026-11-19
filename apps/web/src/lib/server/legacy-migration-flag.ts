// 旧会員（tripla）の会員移行の入口を開くか（2026-11-19）。
// 設計の見直し（docs/legacy-member-migration-design.md・Fable のレビュー）が終わるまで閉じておく。
// 開くときは本番の環境変数 LEGACY_MEMBER_MIGRATION=true（wrangler.jsonc の vars）にする。
// 閉じている間は /auth/migrate は「準備中」、ログイン・会員登録画面のリンクも出さない。
import { env } from '$env/dynamic/private';
import { AUTH_MODE } from '$lib/server/auth';

export function legacyMigrationOpen(): boolean {
	return AUTH_MODE === 'supabase' && env.LEGACY_MEMBER_MIGRATION === 'true';
}
