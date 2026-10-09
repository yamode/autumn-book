// ログイン・認証コードのレート制限（docs/auth-hardening.md §4.1・§8）。KV 無し（メモリ）と KV ありの両方を確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyHit,
  clearRateMemory,
  hashKeyPart,
  ipKey,
  lockRemainingSec,
  memberOtpSendAllowed,
  memberOtpVerifyLocked,
  memberOtpVerifyResult,
  RATE_RULES,
  rateCheck,
  rateHit,
  rateReset,
  recordTtlSec,
  type RateRecord
} from './login-rate-limit';

const MIN = 60_000;

describe('applyHit（純関数）', () => {
  const rule = RATE_RULES.partnerIp; // 10 回/10 分 → 15 分
  it('上限の 1 つ手前まではロックしない', () => {
    let rec: RateRecord | null = null;
    for (let i = 0; i < 9; i++) rec = applyHit(rec, rule, 1_000_000 + i);
    expect(rec!.count).toBe(9);
    expect(lockRemainingSec(rec, 1_000_100)).toBe(0);
  });
  it('10 回目でロック（15 分）・数は 0 に戻る', () => {
    let rec: RateRecord | null = null;
    const t = 1_000_000;
    for (let i = 0; i < 10; i++) rec = applyHit(rec, rule, t);
    expect(rec!.count).toBe(0);
    expect(rec!.lockedUntil).toBe(t + 15 * MIN);
    expect(lockRemainingSec(rec, t)).toBe(15 * 60);
    expect(lockRemainingSec(rec, t + 15 * MIN)).toBe(0);
  });
  it('窓（10 分）を過ぎた失敗は数え直す', () => {
    let rec: RateRecord | null = null;
    for (let i = 0; i < 9; i++) rec = applyHit(rec, rule, 0 + 1);
    rec = applyHit(rec, rule, 10 * MIN + 2);
    expect(rec.count).toBe(1);
    expect(rec.lockedUntil).toBe(0);
  });
  it('lockSec の無いルールは窓の終わりまでロック（1 時間 5 通）', () => {
    const r = RATE_RULES.memberOtpEmail;
    let rec: RateRecord | null = null;
    const start = 5_000_000;
    for (let i = 0; i < 4; i++) rec = applyHit(rec, r, start + i * MIN);
    expect(lockRemainingSec(rec, start + 4 * MIN)).toBe(0);
    rec = applyHit(rec, r, start + 30 * MIN); // 5 通目
    expect(rec.lockedUntil).toBe(start + 60 * MIN);
  });
  it('KV の TTL は 60 秒以上', () => {
    expect(recordTtlSec({ count: 0, windowStart: 0, lockedUntil: 0 }, RATE_RULES.partnerIp, 0)).toBe(60);
    expect(recordTtlSec({ count: 1, windowStart: 0 + 1, lockedUntil: 0 }, RATE_RULES.partnerIp, 1)).toBe(600);
  });
});

describe('ipKey / hashKeyPart', () => {
  it('IP が無ければ unknown', () => {
    expect(ipKey(null)).toBe('unknown');
    expect(ipKey('  ')).toBe('unknown');
    expect(ipKey('203.0.113.1')).toBe('203.0.113.1');
  });
  it('メールは大文字小文字・前後空白を揃えてハッシュ（生の値を残さない）', async () => {
    const a = await hashKeyPart(' Foo@Example.com ');
    expect(a).toBe(await hashKeyPart('foo@example.com'));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain('example');
  });
});

describe('KV 無し（vitest・vite dev）はメモリに落ちる', () => {
  beforeEach(() => clearRateMemory());

  it('取引先ログイン: 10 回失敗でロック・成功で IP の数えが消える', async () => {
    const key = 'p1:203.0.113.1';
    for (let i = 0; i < 9; i++) await rateHit(undefined, RATE_RULES.partnerIp, key);
    expect((await rateCheck(undefined, RATE_RULES.partnerIp, key)).locked).toBe(false);
    await rateReset(undefined, RATE_RULES.partnerIp, key);
    // 成功の後は 9 回失敗してもまだ通る
    for (let i = 0; i < 9; i++) await rateHit(undefined, RATE_RULES.partnerIp, key);
    expect((await rateCheck(undefined, RATE_RULES.partnerIp, key)).locked).toBe(false);
    await rateHit(undefined, RATE_RULES.partnerIp, key);
    const c = await rateCheck(undefined, RATE_RULES.partnerIp, key);
    expect(c.locked).toBe(true);
    expect(c.retryInSec).toBeGreaterThan(14 * 60);
  });

  it('ロック中は成功の記録で解除しない', async () => {
    const key = 'p1:198.51.100.1';
    for (let i = 0; i < 10; i++) await rateHit(undefined, RATE_RULES.partnerIp, key);
    await rateReset(undefined, RATE_RULES.partnerIp, key);
    expect((await rateCheck(undefined, RATE_RULES.partnerIp, key)).locked).toBe(true);
  });

  it('会員の認証コード: 同じメールへ 1 時間 5 通まで（6 通目は拒否）', async () => {
    for (let i = 0; i < 5; i++) expect(await memberOtpSendAllowed(undefined, 'a@example.com', `192.0.2.${i}`)).toBe(true);
    expect(await memberOtpSendAllowed(undefined, 'A@example.com', '192.0.2.200')).toBe(false);
    // 別のメールは通る
    expect(await memberOtpSendAllowed(undefined, 'b@example.com', '192.0.2.201')).toBe(true);
  });

  it('会員の認証コード: 同じ IP から 10 分 10 通まで（メールを変えても 11 通目は拒否）', async () => {
    for (let i = 0; i < 10; i++) expect(await memberOtpSendAllowed(undefined, `u${i}@example.com`, '203.0.113.9')).toBe(true);
    expect(await memberOtpSendAllowed(undefined, 'u99@example.com', '203.0.113.9')).toBe(false);
  });

  it('会員の認証コードの検証: 10 回失敗で止まり、成功で数えが消える', async () => {
    for (let i = 0; i < 9; i++) await memberOtpVerifyResult(undefined, 'c@example.com', false);
    expect(await memberOtpVerifyLocked(undefined, 'c@example.com')).toBe(false);
    await memberOtpVerifyResult(undefined, 'c@example.com', true);
    for (let i = 0; i < 9; i++) await memberOtpVerifyResult(undefined, 'c@example.com', false);
    expect(await memberOtpVerifyLocked(undefined, 'c@example.com')).toBe(false);
    await memberOtpVerifyResult(undefined, 'c@example.com', false);
    expect(await memberOtpVerifyLocked(undefined, 'c@example.com')).toBe(true);
  });
});

describe('KV あり（AB_RATE）', () => {
  afterEach(() => vi.restoreAllMocks());

  function fakeKv() {
    const store = new Map<string, { value: string; ttl?: number }>();
    return {
      store,
      get: vi.fn(async (k: string) => store.get(k)?.value ?? null),
      put: vi.fn(async (k: string, v: string, o?: { expirationTtl?: number }) => {
        store.set(k, { value: v, ttl: o?.expirationTtl });
      })
    };
  }

  it('KV に数え、TTL は 60 秒以上で書く', async () => {
    const kv = fakeKv();
    const platform = { env: { AB_RATE: kv } } as unknown as App.Platform;
    await rateHit(platform, RATE_RULES.adminIp, '203.0.113.1');
    const saved = kv.store.get('login_rate:admin_ip:203.0.113.1');
    expect(saved).toBeTruthy();
    expect(saved!.ttl).toBeGreaterThanOrEqual(60);
    for (let i = 0; i < 9; i++) await rateHit(platform, RATE_RULES.adminIp, '203.0.113.1');
    expect((await rateCheck(platform, RATE_RULES.adminIp, '203.0.113.1')).locked).toBe(true);
  });

  it('KV が読めない・書けないときは通す（締め出さない）', async () => {
    const platform = {
      env: {
        AB_RATE: {
          get: async () => {
            throw new Error('down');
          },
          put: async () => {
            throw new Error('down');
          }
        }
      }
    } as unknown as App.Platform;
    await expect(rateHit(platform, RATE_RULES.partner, 'p1')).resolves.toBeUndefined();
    expect((await rateCheck(platform, RATE_RULES.partner, 'p1')).locked).toBe(false);
  });
});
