// 取引先ポータルのパスワード・トークン（WebCrypto）のテスト。
import { describe, it, expect } from 'vitest';
import { friendlyId, hashPassword, passwordProblem, randomToken, sha256Hex, verifyPassword } from './crypto';

describe('partner crypto', () => {
  it('パスワードのハッシュを検証できる（別パスワード・未設定は通さない）', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^pbkdf2\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterx', hash)).toBe(false);
    expect(await verifyPassword('correct horse battery', null)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    // 同じパスワードでもソルトが違えば別のハッシュ
    expect(await hashPassword('correct horse battery')).not.toBe(hash);
  });

  it('トークン・ID の形', async () => {
    expect(randomToken(18)).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(friendlyId(6)).toMatch(/^[a-km-z2-9]{6}$/);
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('パスワードの条件', () => {
    expect(passwordProblem('short')).toMatch(/10文字/);
    expect(passwordProblem('aaaaaaaaaaaa')).toMatch(/同じ文字/);
    expect(passwordProblem('good-password-1')).toBeNull();
  });
});
