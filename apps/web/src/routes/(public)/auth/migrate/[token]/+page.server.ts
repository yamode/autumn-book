// 会員移行のリンクの着地: トークンを HttpOnly Cookie に移して URL から消し、手続きの画面へ（解析タグ・履歴にトークンを残さない）。
// ここでは状態を変えない（メールのリンクの事前チェックで開かれても使われたことにならない。使うのは手続きの送信のとき）。
import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { isMigrationToken, MIGRATE_COOKIE } from '$lib/server/legacy-members';
import { legacyMigrationOpen } from '$lib/server/legacy-migration-flag';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies, url, setHeaders }) => {
	setHeaders({ 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' });
	if (!legacyMigrationOpen(url) || !isMigrationToken(params.token)) return { state: 'invalid' as const };
	cookies.set(MIGRATE_COOKIE, params.token, { path: '/auth/migrate', httpOnly: true, secure: !dev, sameSite: 'lax', maxAge: 60 * 60 * 24 });
	redirect(303, '/auth/migrate/continue');
};
