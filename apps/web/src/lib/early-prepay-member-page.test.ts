// 特別会員（プライベートブック）の早期決済割の純関数のテスト（SQL の book._early_prepay_discount の p_member_page と同じ考え方）。
import { describe, expect, it } from 'vitest';
import {
  effectiveEarlyPrepaySettings,
  normalizeMemberPageEarlyPrepay,
  prepayDiscountDetail,
  validateMemberPageEarlyPrepay,
  type EarlyPrepaySettings,
  type MemberPageEarlyPrepay
} from './early-prepay';

const BASE: EarlyPrepaySettings = {
  enabled: true,
  mode: 'points',
  tiers: [{ days: 90, percent: 8 }, { days: 120, percent: 12 }],
  blackouts: [{ from: '2027-01-01', to: '2027-01-03', label: '正月' }]
};
const MEMBER: MemberPageEarlyPrepay = { enabled: true, mode: 'discount', tiers: [{ days: 30, percent: 5 }, { days: 60, percent: 10 }] };

describe('予約に当てる設定', () => {
  it('一般の予約（特別会員の束でない）は通常の設定そのもの（特別会員の設定があっても）', () => {
    expect(effectiveEarlyPrepaySettings(BASE, MEMBER, false)).toBe(BASE);
  });
  it('特別会員の束でも、特別会員の設定が未設定なら通常の設定', () => {
    expect(effectiveEarlyPrepaySettings(BASE, null, true)).toBe(BASE);
  });
  it('特別会員の束で設定があれば、段階表・還元方法・ON/OFF は特別会員のもの、除外期間は通常のもの', () => {
    expect(effectiveEarlyPrepaySettings(BASE, MEMBER, true)).toEqual({
      enabled: true,
      mode: 'discount',
      tiers: MEMBER.tiers,
      blackouts: BASE.blackouts
    });
    expect(effectiveEarlyPrepaySettings(BASE, { ...MEMBER, enabled: false }, true).enabled).toBe(false);
  });
});

describe('割引額（特別料金に重ねる）', () => {
  const q = { total: 80000, checkIn: '2027-03-01', flatRate: 0, earlyEligible: true };
  it('45日前: 通常（90日から）は 0、特別会員（30日から 5%）は 4,000円', () => {
    expect(prepayDiscountDetail({ ...q, today: '2027-01-15', settings: BASE }).discount).toBe(0);
    const d = prepayDiscountDetail({ ...q, today: '2027-01-15', settings: effectiveEarlyPrepaySettings(BASE, MEMBER, true) });
    expect(d.mode).toBe('discount');
    expect(d.discount).toBe(4000);
    expect(d.bonusPoints).toBe(0);
  });
  it('60日以上前は 10%・プランの定率の方が大きければ定率', () => {
    const s = effectiveEarlyPrepaySettings(BASE, MEMBER, true);
    expect(prepayDiscountDetail({ ...q, today: '2026-12-01', settings: s }).discount).toBe(8000);
    expect(prepayDiscountDetail({ ...q, flatRate: 0.15, today: '2026-12-01', settings: s }).discount).toBe(12000);
  });
  it('プランが早期決済割の対象外なら特別会員でも段階表は当たらない', () => {
    const s = effectiveEarlyPrepaySettings(BASE, MEMBER, true);
    expect(prepayDiscountDetail({ ...q, earlyEligible: false, today: '2026-12-01', settings: s }).discount).toBe(0);
  });
  it('除外期間は通常の設定のものが特別会員にも効く', () => {
    const s = effectiveEarlyPrepaySettings(BASE, MEMBER, true);
    const d = prepayDiscountDetail({
      total: 40000,
      lines: [{ date: '2027-01-02', subtotal: 20000 }, { date: '2027-01-04', subtotal: 20000 }],
      checkIn: '2027-01-02',
      today: '2026-11-01',
      flatRate: 0,
      earlyEligible: true,
      settings: s
    });
    expect(d.blackoutNights).toBe(1);
    expect(d.discount).toBe(2000);
  });
});

describe('正規化と検証', () => {
  it('null・配列・文字列は未設定', () => {
    expect(normalizeMemberPageEarlyPrepay(null)).toBeNull();
    expect(normalizeMemberPageEarlyPrepay([])).toBeNull();
    expect(normalizeMemberPageEarlyPrepay('x')).toBeNull();
  });
  it('DB の形（enabled・mode・tiers）を読む。除外期間は持たない', () => {
    expect(normalizeMemberPageEarlyPrepay({ enabled: true, mode: 'points', tiers: [{ days: '30', percent: '4.5' }], blackouts: [{ from: '2027-01-01', to: '2027-01-02' }] })).toEqual({
      enabled: true,
      mode: 'points',
      tiers: [{ days: 30, percent: 4.5 }]
    });
  });
  it('段階表の条件は通常と同じ', () => {
    expect(validateMemberPageEarlyPrepay(MEMBER)).toBeNull();
    expect(validateMemberPageEarlyPrepay({ ...MEMBER, tiers: [] })).toMatch('段階');
    expect(validateMemberPageEarlyPrepay({ enabled: false, mode: 'discount', tiers: [] })).toBeNull();
    expect(validateMemberPageEarlyPrepay({ ...MEMBER, tiers: [{ days: 60, percent: 5 }, { days: 30, percent: 10 }] })).toMatch('日数');
    expect(validateMemberPageEarlyPrepay({ ...MEMBER, tiers: [{ days: 30, percent: 25 }] })).toMatch('割引率');
  });
});
