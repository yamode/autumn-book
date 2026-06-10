// デモ用セッション（cookie に JSON を base64 で保存）。本実装は Supabase Auth に置換。
import type { Cookies } from '@sveltejs/kit';

export interface SessionUser {
	id: string;
	role: 'member' | 'admin' | 'staff';
	name: string;
}

const COOKIE = 'ab_session';

export function getSession(cookies: Cookies): SessionUser | null {
	const raw = cookies.get(COOKIE);
	if (!raw) return null;
	try {
		return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
	} catch {
		return null;
	}
}

export function setSession(cookies: Cookies, user: SessionUser) {
	cookies.set(COOKIE, Buffer.from(JSON.stringify(user)).toString('base64'), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 7
	});
}

export function clearSession(cookies: Cookies) {
	cookies.delete(COOKIE, { path: '/' });
}
