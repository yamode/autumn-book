// 取引先 API の施設の決め方（docs/partner-multi-facility.md §7.10・決定 N11・2026-10-09 S5b）
import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('./store', () => ({
  PartnerStoreError: class extends Error {},
  NO_PARTNER_FACILITY_MESSAGE: 'なし',
  composePartnerContext: () => null,
  findPartnerByApiKey: async () => null,
  partnerAdminClient: () => null,
  partnerUnavailableReason: () => null
}));

const { resolveApiFacility, apiFacilityList } = await import('./api');

const YAMADO = { id: 'f-1', slug: 'yamado', name: '山人-yamado-', enabled: true };
const OGA = { id: 'f-2', slug: 'oga', name: '山人-oga-', enabled: true };

describe('resolveApiFacility', () => {
  it('オンが1つなら facility を省略できる（従来どおり）', () => {
    expect(resolveApiFacility([YAMADO, { ...OGA, enabled: false }], null)).toEqual({ ok: true, facilityId: 'f-1' });
    expect(resolveApiFacility([YAMADO], '')).toEqual({ ok: true, facilityId: 'f-1' });
  });
  it('オンが2つ以上で省略は 400 facility_required（N11）', () => {
    expect(resolveApiFacility([YAMADO, OGA], null)).toMatchObject({ ok: false, status: 400, code: 'facility_required' });
  });
  it('slug で選ぶ', () => {
    expect(resolveApiFacility([YAMADO, OGA], 'oga')).toEqual({ ok: true, facilityId: 'f-2' });
    expect(resolveApiFacility([YAMADO], 'yamado')).toEqual({ ok: true, facilityId: 'f-1' });
  });
  it('知らない施設は 400 unknown_facility、オフの施設は 403 facility_disabled', () => {
    expect(resolveApiFacility([YAMADO, OGA], 'nope')).toMatchObject({ ok: false, status: 400, code: 'unknown_facility' });
    expect(resolveApiFacility([YAMADO, { ...OGA, enabled: false }], 'oga')).toMatchObject({ ok: false, status: 403, code: 'facility_disabled' });
  });
  it('オンが1つも無ければ 403 no_facility（N9）', () => {
    expect(resolveApiFacility([{ ...YAMADO, enabled: false }], null)).toMatchObject({ ok: false, status: 403, code: 'no_facility' });
    expect(resolveApiFacility([], null)).toMatchObject({ ok: false, status: 403, code: 'no_facility' });
  });
});

describe('apiFacilityList', () => {
  it('オンの施設の slug と名前だけ', () => {
    expect(apiFacilityList([YAMADO, { ...OGA, enabled: false }])).toEqual([{ slug: 'yamado', name: '山人-yamado-' }]);
  });
});
