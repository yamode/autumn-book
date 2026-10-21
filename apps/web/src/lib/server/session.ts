// デモ用セッション（cookie に JSON を保存）。本実装は Supabase Auth に置換。
// ★2026-10-21 監査: 以前は無署名の JSON で、AUTH_MODE を設定し忘れた環境では Cookie を書き換えるだけで
//   admin になれた。署名付きにし、さらに本番（dev 以外）では ALLOW_DEMO_AUTH=true のときだけ読む。
import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env as privateEnv } from '$env/dynamic/private';
import { signCookieValue, verifyCookieValue } from './signed-cookie';

export interface SessionUser {
	id: string;
	role: 'member' | 'admin' | 'staff';
	name: string;
}

const COOKIE = 'ab_session';

/** デモ認証を使ってよい環境か（開発サーバ、または明示的に許可した環境だけ） */
export function demoAuthAllowed(): boolean {
	return dev || privateEnv.ALLOW_DEMO_AUTH === 'true';
}

export async function getSession(cookies: Cookies): Promise<SessionUser | null> {
	if (!demoAuthAllowed()) return null;
	const raw = await verifyCookieValue(COOKIE, cookies.get(COOKIE));
	if (!raw) return null;
	try {
		// URI エンコード（Cloudflare Workers に Buffer がないため base64 は使わない）
		return JSON.parse(decodeURIComponent(raw));
	} catch {
		return null;
	}
}

export async function setSession(cookies: Cookies, user: SessionUser) {
	if (!demoAuthAllowed()) return;
	cookies.set(COOKIE, await signCookieValue(COOKIE, encodeURIComponent(JSON.stringify(user))), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 7
	});
}

export function clearSession(cookies: Cookies) {
	cookies.delete(COOKIE, { path: '/' });
}
