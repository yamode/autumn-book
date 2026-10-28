// 実行: pnpm --filter @autumn-book/web test -- admin-desktop-sso
import { describe, expect, it } from 'vitest';
import { desktopSsoPrecheck, desktopSsoUserProblem } from './admin-desktop-sso';

const JWT = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2ln';
const h = (o: Record<string, string>) => new Headers(o);

describe('デスクトップ SSO のヘッダ検査', () => {
	it('Bearer と端末名があり、Origin / Referer が無ければ通す', () => {
		expect(desktopSsoPrecheck(h({ authorization: `Bearer ${JWT}`, 'x-autumn-desktop': 'FRONT-PC / Autumn PMS 0.20.0' }))).toEqual({
			ok: true,
			token: JWT,
			device: 'FRONT-PC / Autumn PMS 0.20.0'
		});
	});
	it('ページからの fetch（Origin / Referer 付き）は 403', () => {
		expect(desktopSsoPrecheck(h({ origin: 'https://book.yamado.app', authorization: `Bearer ${JWT}`, 'x-autumn-desktop': 'x' }))).toMatchObject({ ok: false, reason: 'has_origin', status: 403 });
		expect(desktopSsoPrecheck(h({ referer: 'https://evil.example/', authorization: `Bearer ${JWT}`, 'x-autumn-desktop': 'x' }))).toMatchObject({ ok: false, reason: 'has_origin' });
	});
	it('端末名が無ければ 403・Bearer が無い／形が違えば 401', () => {
		expect(desktopSsoPrecheck(h({ authorization: `Bearer ${JWT}` }))).toMatchObject({ ok: false, reason: 'no_desktop_header', status: 403 });
		expect(desktopSsoPrecheck(h({ 'x-autumn-desktop': 'x' }))).toMatchObject({ ok: false, reason: 'no_bearer', status: 401 });
		expect(desktopSsoPrecheck(h({ authorization: 'Bearer notajwt', 'x-autumn-desktop': 'x' }))).toMatchObject({ ok: false, reason: 'no_bearer' });
		expect(desktopSsoPrecheck(h({ authorization: `Basic ${JWT}`, 'x-autumn-desktop': 'x' }))).toMatchObject({ ok: false, reason: 'no_bearer' });
	});
	it('端末名は制御文字を除き 120 文字で切る', () => {
		const r = desktopSsoPrecheck(h({ authorization: `Bearer ${JWT}`, 'x-autumn-desktop': 'a'.repeat(200) }));
		expect(r.ok && r.device.length).toBe(120);
	});
});

describe('デスクトップ SSO で入れる人', () => {
	const now = Date.parse('2026-10-28T00:00:00Z');
	it('admin / staff で停止されていなければ入れる', () => {
		expect(desktopSsoUserProblem({ email: 'a@yamado.co.jp', app_metadata: { role: 'staff' } }, now)).toBeNull();
		expect(desktopSsoUserProblem({ email: 'a@yamado.co.jp', app_metadata: { role: 'admin' }, banned_until: '2020-01-01T00:00:00Z' }, now)).toBeNull();
	});
	it('会員・役割なし・停止中・メールなしは入れない', () => {
		expect(desktopSsoUserProblem(null, now)).toBe('invalid_jwt');
		expect(desktopSsoUserProblem({ email: 'm@example.com', app_metadata: { role: 'member' } }, now)).toBe('not_staff');
		expect(desktopSsoUserProblem({ email: 'm@example.com', app_metadata: {} }, now)).toBe('not_staff');
		expect(desktopSsoUserProblem({ email: 'a@yamado.co.jp', app_metadata: { role: 'staff' }, banned_until: '2099-01-01T00:00:00Z' }, now)).toBe('banned');
		expect(desktopSsoUserProblem({ email: null, app_metadata: { role: 'staff' } }, now)).toBe('no_email');
	});
});
