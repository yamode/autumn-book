import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

describe('ユーザー管理のパスワードの決まり', () => {
	it('10文字以上・英字と数字を含む', async () => {
		const { passwordProblem, normalizeBookRole } = await import('./admin-users');
		expect(passwordProblem('short1')).toMatch(/10 文字以上/);
		expect(passwordProblem('abcdefghijk')).toMatch(/英字と数字/);
		expect(passwordProblem('12345678901')).toMatch(/英字と数字/);
		expect(passwordProblem('yamado2026ok')).toBeNull();
		expect(normalizeBookRole('admin')).toBe('admin');
		expect(normalizeBookRole('staff')).toBe('staff');
		expect(normalizeBookRole('')).toBeNull();
		expect(normalizeBookRole('superadmin')).toBeNull();
	});
});
