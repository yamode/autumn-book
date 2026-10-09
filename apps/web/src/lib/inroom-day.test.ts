import { describe, expect, it } from 'vitest';
import { currentStayDayItems, isCurrentStayDayItem, jstDate } from './inroom-day';

// 日本時間の時刻を Date に
const jst = (s: string) => new Date(`${s}+09:00`);

describe('jstDate', () => {
  it('日本時間の日付（UTC では前日でも）', () => {
    expect(jstDate(jst('2026-10-10T00:30:00'))).toBe('2026-10-10');
    expect(jstDate(jst('2026-10-09T23:59:00'))).toBe('2026-10-09');
  });
});

describe('isCurrentStayDayItem', () => {
  const night = jst('2026-10-09T21:00:00');
  it('今日の予定は出す', () => {
    expect(isCurrentStayDayItem('2026-10-09', '18:00', night)).toBe(true);
  });
  it('明日の朝（11:00 より前）は前の晩から出す', () => {
    expect(isCurrentStayDayItem('2026-10-10', '7:30', night)).toBe(true);
    expect(isCurrentStayDayItem('2026-10-10', '10:59', night)).toBe(true);
  });
  it('明日の昼以降・明後日は出さない', () => {
    expect(isCurrentStayDayItem('2026-10-10', '11:00', night)).toBe(false);
    expect(isCurrentStayDayItem('2026-10-10', '18:00', night)).toBe(false);
    expect(isCurrentStayDayItem('2026-10-11', '07:30', night)).toBe(false);
  });
  it('日付が変わったら前の日の予定は消え、新しい日の予定になる', () => {
    const nextDay = jst('2026-10-10T00:10:00');
    expect(isCurrentStayDayItem('2026-10-09', '18:00', nextDay)).toBe(false);
    expect(isCurrentStayDayItem('2026-10-10', '07:30', nextDay)).toBe(true);
    expect(isCurrentStayDayItem('2026-10-10', '18:00', nextDay)).toBe(true);
    expect(isCurrentStayDayItem('2026-10-11', '07:30', nextDay)).toBe(true);
  });
});

describe('currentStayDayItems', () => {
  it('連泊の食事を今の滞在日だけに絞る', () => {
    const meals = [
      { date: '2026-10-09', time: '18:00', type: 'dinner' },
      { date: '2026-10-10', time: '07:30', type: 'breakfast' },
      { date: '2026-10-10', time: '18:30', type: 'dinner' },
      { date: '2026-10-11', time: '08:00', type: 'breakfast' }
    ];
    const pick = (m: { date: string; time: string }) => m;
    expect(currentStayDayItems(meals, pick, jst('2026-10-09T20:00:00')).map((m) => m.type)).toEqual(['dinner', 'breakfast']);
    expect(currentStayDayItems(meals, pick, jst('2026-10-10T09:00:00')).map((m) => `${m.date} ${m.type}`)).toEqual([
      '2026-10-10 breakfast',
      '2026-10-10 dinner',
      '2026-10-11 breakfast'
    ]);
  });
});
