import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/partners/admin-client', () => ({ partnerServiceClient: () => null }));
vi.mock('$lib/server/mailer', () => ({ sendHtmlEmail: async () => ({ sent: false }) }));
vi.mock('$lib/server/auth', () => ({ createSupabaseServerClient: () => null }));
vi.mock('$lib/server/supabase-data', () => ({ sbRegisterMember: async () => ({}), sbUpdateMyProfile: async () => {} }));

const { isMigrationToken, migrationPasswordError, migrationTokenHash, newMigrationToken } = await import('./legacy-members');

describe('旧会員の会員移行（2026-11-19）', () => {
	it('トークンは推測できない長さで、URL に載る文字だけ', () => {
		const a = newMigrationToken();
		const b = newMigrationToken();
		expect(a).not.toBe(b);
		expect(isMigrationToken(a)).toBe(true);
		expect(isMigrationToken('short')).toBe(false);
		expect(isMigrationToken(`${a}/x`)).toBe(false);
	});
	it('DB に残すのは SHA-256 の 16 進 64 桁', async () => {
		const h = await migrationTokenHash('abc');
		expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	});
	it('パスワードは 12 文字以上・72 バイト以内・確認と一致', () => {
		expect(migrationPasswordError('short', 'short')).toBe('short');
		expect(migrationPasswordError('a'.repeat(73), 'a'.repeat(73))).toBe('long');
		expect(migrationPasswordError('あ'.repeat(25), 'あ'.repeat(25))).toBe('long');
		expect(migrationPasswordError('abcdefghijkl', 'abcdefghijkm')).toBe('mismatch');
		expect(migrationPasswordError('abcdefghijkl', 'abcdefghijkl')).toBeNull();
	});
});
