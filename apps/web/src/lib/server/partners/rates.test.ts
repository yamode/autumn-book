// 取引先に見せる日付範囲の切り詰め（今日〜何日先・公開終了日・1回31日）のテスト。
import { describe, it, expect } from 'vitest';
import { clampPartnerRange } from './rates';

const partner = { max_days_ahead: 90, valid_until: null };

describe('clampPartnerRange', () => {
  it('過去は今日から、先は max_days_ahead まで・1回31日に収める', () => {
    expect(clampPartnerRange(partner, '2026-09-01', '2026-09-30', '2026-09-26')).toEqual({
      from: '2026-09-26',
      to: '2026-09-30',
      earliest: '2026-09-26',
      latest: '2026-12-25'
    });
    expect(clampPartnerRange(partner, '2026-10-01', '2026-12-31', '2026-09-26')).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(clampPartnerRange(partner, '2026-12-20', '2027-01-31', '2026-09-26')).toMatchObject({ from: '2026-12-20', to: '2026-12-25' });
  });

  it('公開終了日で切る・範囲外は null', () => {
    expect(clampPartnerRange({ ...partner, valid_until: '2026-10-10' }, '2026-10-01', '2026-10-31', '2026-09-26')).toMatchObject({ to: '2026-10-10' });
    expect(clampPartnerRange(partner, '2027-01-01', '2027-01-31', '2026-09-26')).toBeNull();
    expect(clampPartnerRange(partner, '2026-08-01', '2026-08-31', '2026-09-26')).toBeNull();
  });
});
