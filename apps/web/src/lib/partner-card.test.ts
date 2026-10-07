import { describe, expect, it } from 'vitest';
import { cardExpiresBefore, cardValidThrough } from './partner-card';

describe('cardValidThrough', () => {
  it('有効期限の月の末日まで使える（うるう年も）', () => {
    expect(cardValidThrough(2, 2028)).toBe('2028-02-29');
    expect(cardValidThrough(12, 2026)).toBe('2026-12-31');
  });
  it('読めない値は null', () => {
    expect(cardValidThrough(null, 2026)).toBeNull();
    expect(cardValidThrough(13, 2026)).toBeNull();
  });
});

describe('cardExpiresBefore', () => {
  it('請求日（チェックアウト日）より前に切れるカードは断る', () => {
    expect(cardExpiresBefore({ exp_month: 11, exp_year: 2026 }, '2026-12-01')).toBe(true);
  });
  it('請求日が有効期限の月の末日以前なら通す', () => {
    expect(cardExpiresBefore({ exp_month: 11, exp_year: 2026 }, '2026-11-30')).toBe(false);
    expect(cardExpiresBefore({ exp_month: 1, exp_year: 2030 }, '2026-12-01')).toBe(false);
  });
  it('有効期限が分からないカードは通す', () => {
    expect(cardExpiresBefore(null, '2026-12-01')).toBe(false);
    expect(cardExpiresBefore({}, '2026-12-01')).toBe(false);
  });
});
