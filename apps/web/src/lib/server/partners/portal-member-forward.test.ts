// B面（/p/<token>）の特別会員の道を畳む（v0.355.0・docs/private-book.md の 5）:
// 特別会員の専用ページ（kind='member'）は、確認モード以外を公式サイトへ転送し、POST などは 410。
// 確認モード・取引先（kind が member 以外）は今までどおり B面で開く。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';

const state = { kind: 'member', preview: false, session: null as { id: string } | null };

class PartnerStoreError extends Error {}
vi.mock('./store', () => ({
  PartnerStoreError,
  SESSION_TTL_HOURS: 12,
  partnerAdminClient: () => ({}),
  findPartnerBundleByUrlToken: async () => ({
    common: { id: '11111111-2222-4333-8444-555555555555', primary_facility_id: 'f1' },
    facilities: [{ facility_id: 'f1', slug: 'oga', enabled: true }]
  }),
  composePartnerContext: () => ({
    id: '11111111-2222-4333-8444-555555555555',
    kind: state.kind,
    name: 'ページ',
    facility_id: 'f1',
    facility_slug: 'oga',
    facility_name: '宿',
    facility_available: true
  }),
  defaultPartnerFacilityId: () => 'f1',
  loadPartnerContext: async () => null,
  NO_PARTNER_FACILITY_MESSAGE: '',
  getPartnerSession: async () => state.session,
  partnerUnavailableReason: () => null
}));
vi.mock('./booking', () => ({ isPartnerBookingOpen: () => true }));
vi.mock('./preview', () => ({
  PARTNER_PREVIEW_COOKIE: 'pv',
  PREVIEW_ACCOUNT_ID: 'preview',
  PREVIEW_DENIED_MESSAGE: '',
  verifyPreviewToken: async () => state.preview
}));

const { resolvePortal, clearPartnerBundleCache } = await import('./portal');

const TOKEN = 'tokentokentoken1';
const eventOf = (path: string, method = 'GET') => ({
  params: { token: TOKEN },
  url: new URL(`https://example.test/p/${TOKEN}${path}`),
  cookies: { get: () => undefined, set: () => undefined, delete: () => undefined },
  request: new Request(`https://example.test/p/${TOKEN}${path}`, { method })
});

async function outcome(path: string, method = 'GET'): Promise<{ redirect?: string; status?: number; ok?: boolean; preview?: boolean }> {
  try {
    const r = await resolvePortal(eventOf(path, method) as never);
    return { ok: true, preview: r.session?.preview === true };
  } catch (e) {
    if (isRedirect(e)) return { redirect: e.location };
    if (isHttpError(e)) return { status: e.status };
    throw e;
  }
}

describe('resolvePortal: 特別会員の専用ページの転送', () => {
  beforeEach(() => {
    clearPartnerBundleCache();
    state.kind = 'member';
    state.preview = false;
    state.session = null;
  });

  it('料金カレンダー・プラン・お部屋・料金表・予約・トップはプライベートブックの入口へ', async () => {
    for (const p of ['', '/', '/calendar', '/plans', '/rooms', '/rate-sheet', '/book?room=A&plan=P']) {
      expect(await outcome(p)).toEqual({ redirect: '/private-book?page=11111111-2222-4333-8444-555555555555' });
    }
  });

  it('ご予約一覧・詳細はマイページへ', async () => {
    expect(await outcome('/bookings')).toEqual({ redirect: '/account/reservations' });
    expect(await outcome('/bookings/YB-2026-000001')).toEqual({ redirect: '/account/reservations/YB-2026-000001' });
    expect(await outcome('/bookings/YB-2026-000001/amend/room/2')).toEqual({ redirect: '/account/reservations/YB-2026-000001/amend/room/2' });
  });

  it('POST は 410（B面で予約を作らない）。取引先のログイン等の使わないルートは今までどおり 404', async () => {
    expect(await outcome('/book', 'POST')).toEqual({ status: 410 });
    expect(await outcome('/bookings/YB-2026-000001?/cancel', 'POST')).toEqual({ status: 410 });
    expect(await outcome('/account')).toEqual({ status: 404 });
  });

  it('取引先のセッションのクッキーがあっても会員のページでは使わない（転送する）', async () => {
    state.session = { id: 'a1' };
    expect(await outcome('/calendar')).toEqual({ redirect: '/private-book?page=11111111-2222-4333-8444-555555555555' });
  });

  it('管理者の確認モードは B面のまま開く（POST も入口では止めない＝各ルートの確認モードの関所が断る）', async () => {
    state.preview = true;
    expect(await outcome('/calendar')).toEqual({ ok: true, preview: true });
    expect(await outcome('/bookings')).toEqual({ ok: true, preview: true });
    expect(await outcome('/book', 'POST')).toEqual({ ok: true, preview: true });
  });

  it('取引先（kind が member 以外）は転送しない', async () => {
    state.kind = 'agent';
    state.session = { id: 'a1' };
    expect(await outcome('/calendar')).toEqual({ ok: true, preview: false });
    expect(await outcome('/bookings')).toEqual({ ok: true, preview: false });
    expect(await outcome('/book', 'POST')).toEqual({ ok: true, preview: false });
  });
});
