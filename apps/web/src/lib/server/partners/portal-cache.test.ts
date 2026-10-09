// 取引先ページの入口（resolvePortal）の一時保存の確認（2026-10-10）:
// 取引先の設定（束）は GET だけ 30 秒使い回し、POST は毎回読み直す。セッションは毎回 DB で確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = { bundle: 0, session: 0 };
let sessionResult: { id: string } | null = { id: 'a1' };

class PartnerStoreError extends Error {}
vi.mock('./store', () => ({
  PartnerStoreError,
  SESSION_TTL_HOURS: 12,
  partnerAdminClient: () => ({}),
  findPartnerBundleByUrlToken: async () => {
    calls.bundle++;
    return { common: { id: 'p1', primary_facility_id: 'f1' }, facilities: [{ facility_id: 'f1', slug: 'oga', enabled: true }] };
  },
  composePartnerContext: () => ({ id: 'p1', name: '取引先', facility_id: 'f1', facility_slug: 'oga', facility_name: '宿', facility_available: true }),
  defaultPartnerFacilityId: () => 'f1',
  loadPartnerContext: async () => null,
  NO_PARTNER_FACILITY_MESSAGE: '',
  getPartnerSession: async (_db: unknown, partner: PromiseLike<{ id: string } | null>) => {
    calls.session++;
    return (await partner) ? sessionResult : null;
  },
  partnerUnavailableReason: () => null
}));
vi.mock('./booking', () => ({ isPartnerBookingOpen: () => true }));
vi.mock('./preview', () => ({
  PARTNER_PREVIEW_COOKIE: 'pv',
  PREVIEW_ACCOUNT_ID: 'preview',
  PREVIEW_DENIED_MESSAGE: '',
  verifyPreviewToken: async () => false
}));

const { resolvePortal, clearPartnerBundleCache, deferTask } = await import('./portal');

const eventOf = (method: string) => ({
  params: { token: 'tokentokentoken1' },
  cookies: { get: (k: string) => (k === 'rms_partner_session' ? 's' : undefined), set: () => undefined, delete: () => undefined },
  request: new Request('https://example.test/p/tokentokentoken1/calendar', { method })
});

describe('resolvePortal の一時保存', () => {
  beforeEach(() => {
    clearPartnerBundleCache();
    calls.bundle = 0;
    calls.session = 0;
    sessionResult = { id: 'a1' };
  });
  afterEach(() => vi.useRealTimers());

  it('GET は 30 秒以内なら取引先の設定を使い回し、セッションは毎回確かめる', async () => {
    await resolvePortal(eventOf('GET') as never);
    await resolvePortal(eventOf('GET') as never);
    expect(calls.bundle).toBe(1);
    expect(calls.session).toBe(2);
  });

  it('ログアウト後（セッションが無い）は使い回し中でも session = null', async () => {
    await resolvePortal(eventOf('GET') as never);
    sessionResult = null;
    const r = await resolvePortal(eventOf('GET') as never);
    expect(r.session).toBeNull();
  });

  it('POST は毎回読み直す', async () => {
    await resolvePortal(eventOf('GET') as never);
    await resolvePortal(eventOf('POST') as never);
    expect(calls.bundle).toBe(2);
  });

  it('30 秒を過ぎたら読み直す', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'));
    await resolvePortal(eventOf('GET') as never);
    vi.setSystemTime(new Date('2026-10-10T00:00:31Z'));
    await resolvePortal(eventOf('GET') as never);
    expect(calls.bundle).toBe(2);
  });
});

describe('deferTask', () => {
  it('waitUntil があれば渡し、失敗は握りつぶす', async () => {
    const got: Promise<unknown>[] = [];
    deferTask({ platform: { context: { waitUntil: (p) => got.push(p) } } }, Promise.reject(new Error('x')));
    expect(got).toHaveLength(1);
    await expect(got[0]).resolves.toBeUndefined();
  });
  it('waitUntil が無くても投げっぱなしで落ちない', () => {
    expect(() => deferTask({}, Promise.reject(new Error('x')))).not.toThrow();
  });
});
