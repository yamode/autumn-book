import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { MAINTENANCE_BYPASS_TOKEN: 'tok-123' } }));

import { isMaintenanceBypassed } from './maintenance';

function ev(pathname: string, role: string | undefined, cookie?: string) {
	const jar = new Map<string, string>(cookie ? [['ab_preview', cookie]] : []);
	const set = vi.fn((k: string, v: string) => void jar.set(k, v));
	const event = {
		url: new URL(`https://book.yamado.app${pathname}`),
		locals: { user: role ? { id: 'u', role, name: 'n' } : null },
		cookies: { get: (k: string) => jar.get(k), set }
	};
	return { event: event as never, set };
}

describe('メンテナンスのバイパス', () => {
	it('運営が公開サイトを見たらプレビュー cookie を発行する（会員ログインに入れ替わっても通すため）', () => {
		const { event, set } = ev('/auth/login', 'admin');
		expect(isMaintenanceBypassed(event)).toBe(true);
		expect(set).toHaveBeenCalledWith('ab_preview', 'tok-123', expect.objectContaining({ httpOnly: true }));
	});
	it('運営が /admin だけを見ていても cookie を発行する', () => {
		const { event, set } = ev('/admin/maintenance', 'staff');
		expect(isMaintenanceBypassed(event)).toBe(true);
		expect(set).toHaveBeenCalled();
	});
	it('cookie が有効なら会員でも通り、再発行しない', () => {
		const { event, set } = ev('/account', 'member', 'tok-123');
		expect(isMaintenanceBypassed(event)).toBe(true);
		expect(set).not.toHaveBeenCalled();
	});
	it('cookie も運営の権限もない会員は通らない', () => {
		const { event } = ev('/account', 'member');
		expect(isMaintenanceBypassed(event)).toBe(false);
	});
});
