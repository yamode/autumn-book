// 管理画面と会員のセッション cookie を分ける（2026-11-22・同じブラウザでマイページに会員でログインすると管理画面が切れていた）
import { describe, expect, it } from 'vitest';
import { BOOK_ADMIN_AUTH_COOKIE, BOOK_AUTH_COOKIE, authCookieKindFor, hasAuthCookie, moveLegacyAdminCookie } from './auth';

type Set = { value: string; opts: Record<string, unknown> };
/** SvelteKit の cookies の最小限（届いた cookie ＋ このリクエストで書いたもの。消したものは空で残る） */
function fakeEvent(initial: Record<string, string>, url = 'https://book.yamado.app/admin') {
	const jar = new Map(Object.entries(initial));
	const written = new Map<string, Set>();
	const cookies = {
		getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
		set: (name: string, value: string, opts: Record<string, unknown>) => {
			jar.set(name, value);
			written.set(name, { value, opts });
		},
		delete: (name: string, opts: Record<string, unknown>) => {
			jar.set(name, '');
			written.set(name, { value: '', opts: { ...opts, maxAge: 0 } });
		}
	};
	return { event: { cookies, url: new URL(url) } as never, written, jar };
}

describe('authCookieKindFor', () => {
	it('/admin 配下は管理画面の cookie、それ以外（マイページ・ログアウト・予約）は会員の cookie', () => {
		expect(authCookieKindFor('/admin')).toBe('admin');
		expect(authCookieKindFor('/admin/login/passkey/verify')).toBe('admin');
		expect(authCookieKindFor('/account')).toBe('member');
		expect(authCookieKindFor('/auth/logout')).toBe('member');
		expect(authCookieKindFor('/administrator')).toBe('member');
	});
	it('名前が別なので、片方にログインしてももう片方を上書きしない', () => expect(BOOK_ADMIN_AUTH_COOKIE).not.toBe(BOOK_AUTH_COOKIE));
});

describe('hasAuthCookie', () => {
	it('分割された cookie（.0 .1）も数える。空の値・似た名前は数えない', () => {
		expect(hasAuthCookie(fakeEvent({ [BOOK_AUTH_COOKIE + '.0']: 'base64-a' }).event, 'member')).toBe(true);
		expect(hasAuthCookie(fakeEvent({ [BOOK_AUTH_COOKIE]: '' }).event, 'member')).toBe(false);
		expect(hasAuthCookie(fakeEvent({ [BOOK_AUTH_COOKIE + '-x']: 'v' }).event, 'member')).toBe(false);
		expect(hasAuthCookie(fakeEvent({ [BOOK_AUTH_COOKIE]: 'base64-a' }).event, 'admin')).toBe(false);
		expect(hasAuthCookie(fakeEvent({ [BOOK_ADMIN_AUTH_COOKIE]: 'base64-a' }).event, 'admin')).toBe(true);
	});
});

describe('moveLegacyAdminCookie（分ける前にログインした運営のセッションを移す）', () => {
	it('会員の cookie（分割も）を管理画面の cookie へ移し、元は消す（同じ refresh token を2か所に残さない）', () => {
		const { event, written } = fakeEvent({ [BOOK_AUTH_COOKIE + '.0']: 'base64-a', [BOOK_AUTH_COOKIE + '.1']: 'b', other: 'x' });
		expect(moveLegacyAdminCookie(event)).toBe(true);
		expect(written.get(BOOK_ADMIN_AUTH_COOKIE + '.0')).toMatchObject({ value: 'base64-a', opts: { path: '/', sameSite: 'lax', secure: true } });
		expect(written.get(BOOK_ADMIN_AUTH_COOKIE + '.1')?.value).toBe('b');
		expect(written.get(BOOK_AUTH_COOKIE + '.0')).toMatchObject({ value: '', opts: { maxAge: 0, path: '/' } });
		expect(written.get(BOOK_AUTH_COOKIE + '.1')?.value).toBe('');
		expect(written.has('other')).toBe(false);
		expect(hasAuthCookie(event, 'admin')).toBe(true);
		expect(hasAuthCookie(event, 'member')).toBe(false);
	});
	it('管理画面の cookie がもうあれば何もしない（会員のログインを消さない）', () => {
		const { event, written } = fakeEvent({ [BOOK_ADMIN_AUTH_COOKIE]: 'base64-admin', [BOOK_AUTH_COOKIE]: 'base64-member' });
		expect(moveLegacyAdminCookie(event)).toBe(false);
		expect(written.size).toBe(0);
	});
	it('会員の cookie が無ければ何もしない', () => expect(moveLegacyAdminCookie(fakeEvent({}).event)).toBe(false));
});
