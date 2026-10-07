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

describe('cardExpiresBefore（更新の時期＝2か月を見込む）', () => {
  it('請求日より前に切れるカードは断る', () => {
    expect(cardExpiresBefore({ exp_month: 10, exp_year: 2026 }, '2026-11-20')).toBe(true);
  });
  it('請求日の月・翌月に有効期限を迎えるカードは更新の時期なので断る', () => {
    expect(cardExpiresBefore({ exp_month: 11, exp_year: 2026 }, '2026-11-20')).toBe(true);
    expect(cardExpiresBefore({ exp_month: 12, exp_year: 2026 }, '2026-11-20')).toBe(true);
  });
  it('請求日の月の2か月後以降に有効期限を迎えるカードは通す（年またぎも）', () => {
    expect(cardExpiresBefore({ exp_month: 1, exp_year: 2027 }, '2026-11-20')).toBe(false);
    expect(cardExpiresBefore({ exp_month: 1, exp_year: 2030 }, '2026-11-20')).toBe(false);
  });
  it('余裕を 0 にすると、請求日に切れていなければ通す', () => {
    expect(cardExpiresBefore({ exp_month: 11, exp_year: 2026 }, '2026-11-30', 0)).toBe(false);
    expect(cardExpiresBefore({ exp_month: 10, exp_year: 2026 }, '2026-11-01', 0)).toBe(true);
  });
  it('有効期限が分からないカードは通す', () => {
    expect(cardExpiresBefore(null, '2026-12-01')).toBe(false);
    expect(cardExpiresBefore({}, '2026-12-01')).toBe(false);
  });
});
