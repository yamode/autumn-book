// 取引先ページの施設の選択（docs/partner-multi-facility.md §7.8・決定 N1/N9・2026-10-09）。
// ?f= → クッキー → primary_facility_id → オンの先頭 → なし（null）。オフ・不明な slug は無視する。
import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('./store', () => ({ PartnerStoreError: class extends Error {}, SESSION_TTL_HOURS: 12 }));
vi.mock('./booking', () => ({ isPartnerBookingOpen: () => true }));
vi.mock('./preview', () => ({ PARTNER_PREVIEW_COOKIE: 'pv', PREVIEW_ACCOUNT_ID: 'x', PREVIEW_DENIED_MESSAGE: '', verifyPreviewToken: async () => false }));

const { selectPartnerFacility } = await import('./portal');

const NISHIWAGA = { id: 'f-1', slug: 'yamado', enabled: true };
const OGA = { id: 'f-2', slug: 'oga', enabled: true };

describe('selectPartnerFacility', () => {
  it('?f= がオンの施設ならそれ（クッキーより優先）', () => {
    expect(selectPartnerFacility([NISHIWAGA, OGA], 'f-1', { query: 'oga', cookie: 'yamado' })).toEqual({ facilityId: 'f-2', source: 'query' });
  });
  it('?f= がオフ・不明なら無視してクッキー', () => {
    const offOga = { ...OGA, enabled: false };
    expect(selectPartnerFacility([NISHIWAGA, offOga], null, { query: 'oga', cookie: 'yamado' })).toEqual({ facilityId: 'f-1', source: 'cookie' });
    expect(selectPartnerFacility([NISHIWAGA, OGA], null, { query: 'nope', cookie: 'oga' })).toEqual({ facilityId: 'f-2', source: 'cookie' });
  });
  it('クッキーがオフの施設なら primary_facility_id', () => {
    expect(selectPartnerFacility([NISHIWAGA, { ...OGA, enabled: false }], 'f-1', { cookie: 'oga' })).toEqual({ facilityId: 'f-1', source: 'primary' });
  });
  it('primary がオフ・未設定ならオンの先頭（渡された並び順）', () => {
    expect(selectPartnerFacility([{ ...NISHIWAGA, enabled: false }, OGA], 'f-1', {})).toEqual({ facilityId: 'f-2', source: 'first' });
    expect(selectPartnerFacility([NISHIWAGA, OGA], null, {})).toEqual({ facilityId: 'f-1', source: 'first' });
  });
  it('オンが1つも無ければ null（N9）', () => {
    expect(selectPartnerFacility([{ ...NISHIWAGA, enabled: false }], 'f-1', { query: 'yamado' })).toEqual({ facilityId: null, source: 'none' });
    expect(selectPartnerFacility([], null, {})).toEqual({ facilityId: null, source: 'none' });
  });
});
