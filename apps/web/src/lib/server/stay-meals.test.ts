import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/supabase', () => ({ supa: () => ({}) }));
const { normalizeStayMeals } = await import('./stay-meals');

describe('normalizeStayMeals', () => {
  it('同じ日は 朝食→昼食→夕食、日付順に並べる', () => {
    const r = normalizeStayMeals({
      meals: [
        { date: '2026-10-05', type: 'dinner', time: '18:30', status: 'confirmed' },
        { date: '2026-10-05', type: 'breakfast', time: '07:30', status: 'confirmed' },
        { date: '2026-10-04', type: 'dinner', time: '18:00', status: 'confirmed' }
      ]
    });
    expect(r.map((m) => `${m.date} ${m.type}`)).toEqual(['2026-10-04 dinner', '2026-10-05 breakfast', '2026-10-05 dinner']);
  });
  it('申請中（将来の事前チェックイン）は requested のまま、知らない状態は confirmed', () => {
    const r = normalizeStayMeals({ meals: [{ date: '2026-10-04', type: 'dinner', time: '19:00', status: 'requested' }, { date: '2026-10-05', type: 'breakfast', time: '8:00', status: 'x' }] });
    expect(r.map((m) => m.status)).toEqual(['requested', 'confirmed']);
  });
  it('壊れた行・知らない種別・時間なしは落とす', () => {
    expect(normalizeStayMeals({ meals: [{ date: '2026-10-04', type: 'tea', time: '15:00' }, { date: 'x', type: 'dinner', time: '18:00' }, { date: '2026-10-04', type: 'dinner', time: '' }] })).toEqual([]);
    expect(normalizeStayMeals(null)).toEqual([]);
  });
});
