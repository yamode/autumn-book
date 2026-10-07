// 予約時決済の事務手数料（取消時に返金しない率・2026-10-07）の計算
import { describe, expect, it } from 'vitest';
import { adminFeeOf, adminFeePercentError, deductionOf, normalizeAdminFeePercent, readAdminFeeTerms } from './cancel-admin-fee';
import { directRefundDueOf } from './direct-payment';
import { partnerRefundOf, settlementText, type SettlementSource } from './partner-cancel-fee';

describe('事務手数料の率', () => {
  it('3.6% 以下・0%・20% 超は保存できない。3.7〜20 は保存できる', () => {
    expect(adminFeePercentError(3.6)).not.toBeNull();
    expect(adminFeePercentError('3.6')).not.toBeNull();
    expect(adminFeePercentError(0)).not.toBeNull();
    expect(adminFeePercentError('')).not.toBeNull();
    expect(adminFeePercentError('abc')).not.toBeNull();
    expect(adminFeePercentError(20.1)).not.toBeNull();
    expect(adminFeePercentError(3.7)).toBeNull();
    expect(adminFeePercentError(5)).toBeNull();
    expect(adminFeePercentError(20)).toBeNull();
  });
  it('読めない値・範囲外は既定の 5%', () => {
    expect(normalizeAdminFeePercent(null)).toBe(5);
    expect(normalizeAdminFeePercent('2')).toBe(5);
    expect(normalizeAdminFeePercent('7.5')).toBe(7.5);
  });
  it('額は floor(支払額 × 率)', () => {
    expect(adminFeeOf(100_000, 5)).toBe(5_000);
    expect(adminFeeOf(12_345, 4.5)).toBe(555); // 555.525 → 555
    expect(adminFeeOf(100_000, null)).toBe(0);
  });
  it('予約に残した率と免除', () => {
    expect(readAdminFeeTerms({ rules: [], admin_fee_percent: 5 })).toEqual({ percent: 5, waived: false });
    expect(readAdminFeeTerms({ admin_fee_percent: 5, admin_fee_waived: true })).toEqual({ percent: 5, waived: true });
    expect(readAdminFeeTerms(null)).toEqual({ percent: null, waived: false });
  });
});

describe('差し引く額 = max(キャンセル料, 割引額, 事務手数料)', () => {
  const base = { paid: 100_000, adminFeePercent: 5 };
  it('支払 100,000・率 5%・キャンセル料 0 → 返金 95,000（事務手数料）', () => {
    const d = deductionOf({ ...base, fee: 0 });
    expect(d).toMatchObject({ kept: 5_000, reason: 'admin_fee' });
    expect(directRefundDueOf({ amount: 100_000, fee: 0, adminFeePercent: 5 })).toBe(95_000);
  });
  it('キャンセル料 10%（10,000）→ 返金 90,000（キャンセル料・足し合わせない）', () => {
    expect(deductionOf({ ...base, fee: 10_000 })).toMatchObject({ kept: 10_000, reason: 'cancel_fee' });
    expect(directRefundDueOf({ amount: 100_000, fee: 10_000, adminFeePercent: 5 })).toBe(90_000);
  });
  it('割引 3,000・キャンセル料 0 → 返金 95,000（事務手数料 5,000 が大きい）', () => {
    expect(deductionOf({ ...base, fee: 0, discount: 3_000 })).toMatchObject({ kept: 5_000, reason: 'admin_fee' });
    expect(directRefundDueOf({ amount: 100_000, fee: 0, prepayDiscount: 3_000, adminFeePercent: 5 })).toBe(95_000);
  });
  it('割引の方が大きければ割引額', () => {
    expect(deductionOf({ ...base, fee: 0, discount: 8_000 })).toMatchObject({ kept: 8_000, reason: 'prepay_discount' });
  });
  it('率の無い導入前の予約は従来どおり（事務手数料なし）', () => {
    expect(directRefundDueOf({ amount: 100_000, fee: 0 })).toBe(100_000);
  });
  it('キャンセル料の免除でも事務手数料は差し引く（既定）。事務手数料も免除なら全額返金', () => {
    expect(directRefundDueOf({ amount: 100_000, fee: 0, prepayDiscount: 8_000, waived: true, adminFeePercent: 5 })).toBe(95_000);
    expect(directRefundDueOf({ amount: 100_000, fee: 0, waived: true, adminFeePercent: 5, adminFeeWaived: true })).toBe(100_000);
  });
  it('入湯税は必ず返す（事務手数料は入湯税を除いた支払額まで）', () => {
    expect(deductionOf({ paid: 1_000, bathTax: 980, fee: 0, adminFeePercent: 5 }).kept).toBe(20);
  });
});

describe('取引先予約の返金（partnerRefundOf）', () => {
  const online: SettlementSource = {
    status: 'confirmed',
    total_amount: 100_000,
    bath_tax_amount: 0,
    prepay_discount_amount: 3_000,
    payment_status: 'paid',
    payment_option: 'online',
    paid_amount: 100_000,
    cancel_policy: { rules: [], no_show_rate_percent: null, admin_fee_percent: 5 }
  };
  it('予約時決済: キャンセル料 0・割引 3,000 → 事務手数料 5,000 を差し引き 95,000 返金', () => {
    const r = partnerRefundOf(online, 0);
    expect(r).toMatchObject({ paid: 100_000, kept: 5_000, refund: 95_000, reason: 'admin_fee', adminFee: 5_000, adminFeePercent: 5 });
    expect(settlementText('refund', 0, '2026年10月', r)).toContain('事務手数料（5%）');
  });
  it('キャンセル料の免除でも事務手数料は差し引く。事務手数料も免除なら全額返金', () => {
    expect(partnerRefundOf(online, 0, true).refund).toBe(95_000);
    expect(partnerRefundOf(online, 0, true, true).refund).toBe(100_000);
    expect(partnerRefundOf({ ...online, cancel_policy: { admin_fee_percent: 5, admin_fee_waived: true } }, 0, true).refund).toBe(100_000);
  });
  it('率の無い予約（導入前）は従来どおり max(キャンセル料, 割引額)', () => {
    expect(partnerRefundOf({ ...online, cancel_policy: null }, 0)).toMatchObject({ kept: 3_000, reason: 'prepay_discount' });
  });
  it('デポジット: 充当 = max(キャンセル料, デポジット × 率)。不足分はキャンセル料だけから', () => {
    const dep: SettlementSource = {
      ...online,
      prepay_discount_amount: 0,
      payment_option: 'deposit_online',
      deposit_amount: 30_000,
      paid_amount: 30_000,
      remainder_option: 'onsite'
    };
    expect(partnerRefundOf(dep, 0)).toMatchObject({ kept: 1_500, refund: 28_500, shortage: 0, reason: 'admin_fee' });
    expect(partnerRefundOf(dep, 10_000)).toMatchObject({ kept: 10_000, refund: 20_000, reason: 'cancel_fee' });
    // 残額が現地でも不足分は請求書（2026-10-07 変更）
    expect(partnerRefundOf(dep, 50_000)).toMatchObject({ kept: 30_000, refund: 0, shortage: 20_000, shortageBilled: 20_000 });
  });
});
