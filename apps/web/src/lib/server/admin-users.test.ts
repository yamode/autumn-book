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

describe('受電専用アカウントの作成（入力の検査）', () => {
	it('施設が無い・メールが不正・パスワードが弱いときは作らずに断る', async () => {
		const { createIntercomOperator } = await import('./admin-users');
		const base = { actorId: 'a', email: 'review@example.com', name: '審査用', password: 'yamado2026ok', facilityIds: ['f1'] };
		await expect(createIntercomOperator({ ...base, facilityIds: [] })).rejects.toThrow(/施設を 1 つ以上/);
		await expect(createIntercomOperator({ ...base, email: 'not-an-email' })).rejects.toThrow(/メールアドレス/);
		await expect(createIntercomOperator({ ...base, password: 'short1' })).rejects.toThrow(/10 文字以上/);
	});
});
