import { describe, expect, it } from 'vitest';
import { groupByDay, isUpcoming, jstDate, upcomingItems } from './inroom-day';

// 日本時間の時刻を Date に
const jst = (s: string) => new Date(`${s}+09:00`);

describe('jstDate', () => {
  it('日本時間の日付（UTC では前日でも）', () => {
    expect(jstDate(jst('2026-10-10T00:30:00'))).toBe('2026-10-10');
    expect(jstDate(jst('2026-10-09T23:59:00'))).toBe('2026-10-09');
  });
});

describe('isUpcoming（食事: 始まりから60分は出す）', () => {
  const breakfast = { date: '2026-10-10', start: '7:30' };
  it('当日7時はその日の朝食を出す', () => {
    expect(isUpcoming(breakfast, jst('2026-10-10T07:00:00'))).toBe(true);
  });
  it('食事中（始まりから60分以内）は出す・過ぎたら隠す', () => {
    expect(isUpcoming(breakfast, jst('2026-10-10T08:29:00'))).toBe(true);
    expect(isUpcoming(breakfast, jst('2026-10-10T08:30:00'))).toBe(false);
  });
  it('前の晩・前の日から先の予定は出す', () => {
    expect(isUpcoming(breakfast, jst('2026-10-09T21:00:00'))).toBe(true);
    expect(isUpcoming({ date: '2026-10-12', start: '18:00' }, jst('2026-10-10T07:00:00'))).toBe(true);
  });
});

describe('isUpcoming（貸切風呂: 枠の終わりまで出す）', () => {
  it('枠の終わりを過ぎたら隠す', () => {
    const slot = { date: '2026-10-09', start: '21:00', end: '21:45' };
    expect(isUpcoming(slot, jst('2026-10-09T21:30:00'))).toBe(true);
    expect(isUpcoming(slot, jst('2026-10-09T21:45:00'))).toBe(false);
  });
  it('0時をまたぐ枠は翌日の終わりまで', () => {
    const slot = { date: '2026-10-09', start: '23:30', end: '0:15' };
    expect(isUpcoming(slot, jst('2026-10-10T00:10:00'))).toBe(true);
    expect(isUpcoming(slot, jst('2026-10-10T00:20:00'))).toBe(false);
  });
});

describe('upcomingItems / groupByDay', () => {
  const meals = [
    { date: '2026-10-09', time: '18:00', type: 'dinner' },
    { date: '2026-10-10', time: '07:30', type: 'breakfast' },
    { date: '2026-10-10', time: '18:30', type: 'dinner' },
    { date: '2026-10-11', time: '08:00', type: 'breakfast' }
  ];
  const pick = (m: { date: string; time: string }) => ({ date: m.date, start: m.time });
  it('連泊2日目の7時: 前の晩の夕食だけ消え、その日の朝食から先が残る', () => {
    expect(upcomingItems(meals, pick, jst('2026-10-10T07:00:00')).map((m) => `${m.date} ${m.type}`)).toEqual([
      '2026-10-10 breakfast',
      '2026-10-10 dinner',
      '2026-10-11 breakfast'
    ]);
  });
  it('日ごとにまとめる', () => {
    const groups = groupByDay(upcomingItems(meals, pick, jst('2026-10-10T07:00:00')));
    expect(groups.map((g) => [g.date, g.items.length])).toEqual([
      ['2026-10-10', 2],
      ['2026-10-11', 1]
    ]);
  });
});
