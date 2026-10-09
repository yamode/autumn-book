// 取引先ページの施設の選択（docs/partner-multi-facility.md §7.8・決定 N1/N9・2026-10-09）。
// ?f= → クッキー → primary_facility_id → オンの先頭 → なし（null）。オフ・不明な slug は無視する。
import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('./store', () => ({ PartnerStoreError: class extends Error {}, SESSION_TTL_HOURS: 12 }));
vi.mock('./booking', () => ({ isPartnerBookingOpen: () => true }));
vi.mock('./preview', () => ({ PARTNER_PREVIEW_COOKIE: 'pv', PREVIEW_ACCOUNT_ID: 'x', PREVIEW_DENIED_MESSAGE: '', verifyPreviewToken: async () => false }));

const { selectPartnerFacility, facilitySwitchTarget, portalFacilityChoices } = await import('./portal');

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

// 切替の戻り先（S4・2026-10-09）: /p/<token> の中だけ・?f= を外す・予約入力は料金カレンダーへ
describe('facilitySwitchTarget', () => {
  it('同じページ（クエリは残し、?f= だけ外す）', () => {
    expect(facilitySwitchTarget('tok', '/p/tok/bookings')).toBe('/p/tok/bookings');
    expect(facilitySwitchTarget('tok', '/p/tok/calendar?date=2026-11-01&f=oga&nights=2')).toBe('/p/tok/calendar?date=2026-11-01&nights=2');
    expect(facilitySwitchTarget('tok', '/p/tok/legal/tokushoho?f=oga')).toBe('/p/tok/legal/tokushoho');
  });
  it('予約入力（/book）は前の施設の部屋なので料金カレンダーへ（/bookings はそのまま）', () => {
    expect(facilitySwitchTarget('tok', '/p/tok/book?room=A&plan=B')).toBe('/p/tok/calendar');
    expect(facilitySwitchTarget('tok', '/p/tok/bookings?done=X')).toBe('/p/tok/bookings?done=X');
  });
  it('外・別トークン・不正な値はトップへ', () => {
    expect(facilitySwitchTarget('tok', 'https://evil.example/p/tok')).toBe('/p/tok');
    expect(facilitySwitchTarget('tok', '//evil.example/p/tok')).toBe('/p/tok');
    expect(facilitySwitchTarget('tok', '/p/other/calendar')).toBe('/p/tok');
    expect(facilitySwitchTarget('tok', '/p/tokX/calendar')).toBe('/p/tok');
    expect(facilitySwitchTarget('tok', '')).toBe('/p/tok');
    expect(facilitySwitchTarget('tok', null)).toBe('/p/tok');
  });
});

describe('portalFacilityChoices', () => {
  const f = (id: string, slug: string, enabled: boolean) => ({ id, slug, name: slug, enabled, bookingEnabled: enabled, sortOrder: 0 });
  it('オンの施設だけ（並び順のまま）。1つなら切替を出さない判定に使う', () => {
    expect(portalFacilityChoices({ facilities: [f('1', 'yamado', true), f('2', 'oga', true)] })).toEqual([
      { slug: 'yamado', name: 'yamado' },
      { slug: 'oga', name: 'oga' }
    ]);
    expect(portalFacilityChoices({ facilities: [f('1', 'yamado', true), f('2', 'oga', false)] })).toHaveLength(1);
  });
});
