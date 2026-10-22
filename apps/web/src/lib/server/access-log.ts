// 管理画面のアクセスログ（core.access_logs）の Book 側の入口（2026-10-22）。
// 対象は運営の管理画面（/admin 配下）だけ。お客様向けの公開サイト・取引先ページは記録しない。
//   ・hooks.server.ts が応答のたびに 1 行（画面表示・操作・拒否）
//   ・管理画面のログインが成功・失敗を 1 行（markAccessLogged で hooks 側の重複記録を止める）
// 閲覧・不正アクセスの検知と通知は PMS（設定 > ログ > アクセスログ・/api/cron/security-alerts）。
import type { RequestEvent } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { recordAccess, waitUntilOf, type AccessLogInput } from './access-log-core';

const LOGGED = Symbol.for('autumn.accessLogged');

function cfg() {
	return {
		supabaseUrl: privateEnv.SUPABASE_URL || publicEnv.PUBLIC_SUPABASE_URL,
		serviceRoleKey: privateEnv.SUPABASE_SERVICE_ROLE_KEY
	};
}

function marked(event: RequestEvent): boolean {
	return (event.locals as unknown as Record<symbol, boolean>)[LOGGED] === true;
}

/** ログインの成功・失敗などを明示して記録する */
export function logAccessEvent(event: RequestEvent, input: Omit<AccessLogInput, 'app'>): void {
	(event.locals as unknown as Record<symbol, boolean>)[LOGGED] = true;
	recordAccess(event, { app: 'book', ...input }, cfg());
}

/** 応答のあとに 1 行（hooks.server.ts から・/admin 配下だけ） */
export function logAdminAccess(event: RequestEvent, status: number): void {
	if (marked(event) || !event.url.pathname.startsWith('/admin')) return;
	const u = event.locals.user;
	const user = u && (u.role === 'admin' || u.role === 'staff') ? { id: u.id, email: null } : null;
	const work = Promise.resolve().then(() => recordAccess(event, { app: 'book', user, status }, cfg()));
	const wait = waitUntilOf(event.platform);
	if (wait) wait(work);
}
