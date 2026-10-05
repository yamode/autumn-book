import { describe, expect, it } from 'vitest';
import { partnerBackTarget, partnerStayOffers } from './partner-stay';
import type { PartnerRateDay } from './partner-pricing';

const plan = (code: string, price: number) => ({ planCode: code, planName: `P${code}`, mealType: '2食', advance: false, pricesPerPerson: { '2': price } });
const day = (date: string, rooms: PartnerRateDay['rooms'], closed = false): PartnerRateDay => ({ date, closed, remainingRooms: null, rooms });
const days = new Map<string, PartnerRateDay>([
  ['2026-10-10', day('2026-10-10', [{ roomCode: 'A', roomName: '部屋A', remainingRooms: 2, plans: [plan('x', 30000), plan('y', 40000)] }])],
  ['2026-10-11', day('2026-10-11', [{ roomCode: 'A', roomName: '部屋A', remainingRooms: 1, plans: [plan('x', 34000)] }])],
  ['2026-10-12', day('2026-10-12', [], true)]
]);
const dayOf = (iso: string) => days.get(iso);

describe('partnerStayOffers', () => {
  it('1泊はその日の部屋×プランを安い順', () => {
    const offers = partnerStayOffers(dayOf, '2026-10-10', 1, 2, { showInventory: true });
    expect(offers?.map((o) => [o.planCode, o.perPerson])).toEqual([['x', 30000], ['y', 40000]]);
  });
  it('2泊は全泊そろうプランだけ・平均と最小残室', () => {
    const offers = partnerStayOffers(dayOf, '2026-10-10', 2, 2, { showInventory: true });
    expect(offers).toEqual([
      { roomCode: 'A', roomName: '部屋A', planCode: 'x', planName: 'Px', mealType: '2食', advance: false, perPerson: 32000, totalPerPerson: 64000, remaining: 1 }
    ]);
  });
  it('途中に休館日があれば泊まれない', () => {
    expect(partnerStayOffers(dayOf, '2026-10-11', 2, 2, { showInventory: true })).toEqual([]);
  });
  it('途中の日のデータが無ければ null（判定できない）', () => {
    expect(partnerStayOffers(dayOf, '2026-10-10', 3, 2, { showInventory: true })).toEqual([]);
    expect(partnerStayOffers(dayOf, '2026-10-09', 2, 2, { showInventory: true })).toBeNull();
  });
  it('プランで絞る', () => {
    const offers = partnerStayOffers(dayOf, '2026-10-10', 1, 2, { showInventory: true, planCode: 'y', planName: 'Py' });
    expect(offers?.map((o) => o.planCode)).toEqual(['y']);
  });
});

describe('partnerBackTarget', () => {
  it('プランのご紹介から来たらそこへ戻る', () => {
    expect(partnerBackTarget('tk', '/p/tk/plans#plan-a')).toEqual({ href: '/p/tk/plans#plan-a', label: 'プランのご紹介へ戻る' });
  });
  it('お部屋とプランから来たら条件つきで戻る', () => {
    expect(partnerBackTarget('tk', '/p/tk/stay?date=2026-10-10&nights=2&guests=2')).toEqual({ href: '/p/tk/stay?date=2026-10-10&nights=2&guests=2', label: 'お部屋とプランへ戻る' });
  });
  it('料金カレンダーは条件つきで戻る', () => {
    expect(partnerBackTarget('tk', '/p/tk/calendar?month=2026-10&guests=2').href).toBe('/p/tk/calendar?month=2026-10&guests=2');
  });
  it('ほかの取引先・外部は料金カレンダーへ', () => {
    expect(partnerBackTarget('tk', '/p/other/plans').href).toBe('/p/tk/calendar');
    expect(partnerBackTarget('tk', 'https://example.com/').href).toBe('/p/tk/calendar');
    expect(partnerBackTarget('tk', null).label).toBe('料金カレンダーへ戻る');
  });
});
