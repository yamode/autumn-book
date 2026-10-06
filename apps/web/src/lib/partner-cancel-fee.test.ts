import { describe, expect, it } from 'vitest';
import {
  cancelPolicyTable,
  daysBeforeStay,
  partnerRefundOf,
  planCancelPolicy,
  quoteCancelFee,
  rateFor,
  readCancelPolicy,
  settlementOf,
  type CancelPolicy
} from './partner-cancel-fee';

const policy: CancelPolicy = {
  rules: [
    { days_before: 3, rate_percent: 30 },
    { days_before: 1, rate_percent: 50 },
    { days_before: 0, rate_percent: 80 }
  ],
  noShowPercent: 100
};
// 2026-10-10 14:00 JST
const at = (iso: string) => new Date(`${iso}+09:00`);

describe('料率', () => {
  it('N日前から X% の段を当てる', () => {
    expect([5, 4, 3, 2, 1, 0].map((d) => rateFor(policy, d))).toEqual([0, 0, 30, 30, 50, 80]);
  });
  it('宿泊日の何日前かは JST の暦日', () => {
    expect(daysBeforeStay('2026-10-12', at('2026-10-10T23:59:00'))).toBe(2);
    expect(daysBeforeStay('2026-10-12', at('2026-10-11T00:01:00'))).toBe(1);
    expect(daysBeforeStay('2026-10-12', at('2026-10-13T10:00:00'))).toBe(0);
  });
  it('基準は割引前・入湯税を除く予約金額。円未満は切り捨て', () => {
    const q = quoteCancelFee({ total_amount: 52_001, check_in_date: '2026-10-12' }, policy, { now: at('2026-10-10T14:00:00') });
    expect(q).toEqual({ base: 52_001, daysBefore: 2, rate: 30, fee: 15_600, basis: '2日前' });
    expect(quoteCancelFee({ total_amount: 52_000, check_in_date: '2026-10-12' }, policy, { noShow: true }).fee).toBe(52_000);
  });
  it('規定が無ければ 0円', () => {
    expect(quoteCancelFee({ total_amount: 52_000, check_in_date: '2026-10-12' }, null, { now: at('2026-10-12T10:00:00') }).fee).toBe(0);
  });
});

describe('規定の読み込み', () => {
  const raw = {
    plans: [{ plan_code: 'A', plan_label: '朝食付', cancellation_policy: [{ days_before: 7, rate_percent: 20 }] }],
    default_cancellation: { rules: [{ days_before: 2, rate_percent: 50 }], no_show_rate_percent: 100 }
  };
  it('プラン個別があればそれ、無ければ施設の既定', () => {
    expect(planCancelPolicy(raw, 'A', '朝食付')).toEqual({ rules: [{ days_before: 7, rate_percent: 20 }], noShowPercent: null });
    expect(planCancelPolicy(raw, 'B', '素泊まり')).toEqual({ rules: [{ days_before: 2, rate_percent: 50 }], noShowPercent: 100 });
  });
  it('保存した形を読み戻せる', () => {
    expect(readCancelPolicy({ rules: policy.rules, no_show_rate_percent: 100 })).toEqual(policy);
    expect(readCancelPolicy(null)).toBeNull();
  });
});

describe('規定の表', () => {
  it('無料の段・期間・今の段・不泊', () => {
    expect(cancelPolicyTable(policy, 2)).toEqual([
      { label: '4日前まで', rate: 0, current: false },
      { label: '3日前〜2日前', rate: 30, current: true },
      { label: '前日', rate: 50, current: false },
      { label: '当日', rate: 80, current: false },
      { label: '不泊', rate: 100, current: false }
    ]);
    expect(cancelPolicyTable({ rules: [{ days_before: 3, rate_percent: 30 }], noShowPercent: null }, 9)[0].current).toBe(true);
    expect(cancelPolicyTable({ rules: [{ days_before: 3, rate_percent: 30 }], noShowPercent: null }, 9)[1].label).toBe('3日前〜当日');
  });
});

describe('精算', () => {
  const base = { status: 'confirmed', paid_amount: null, total_amount: 52_000, bath_tax_amount: 300, prepay_discount_amount: 0, payment_status: 'none', payment_option: 'invoice_monthly' };
  it('支払方法ごとの精算', () => {
    expect(settlementOf(base, 15_600)).toBe('invoice');
    expect(settlementOf(base, 0)).toBe('none');
    expect(settlementOf({ ...base, payment_option: 'custom_x' }, 100)).toBe('invoice');
    expect(settlementOf({ ...base, payment_status: 'paid', payment_option: 'online' }, 0)).toBe('refund');
    expect(settlementOf({ ...base, payment_status: 'scheduled', payment_option: 'online_checkin', stripe_payment_method_id: 'pm_1' }, 100)).toBe('card');
    expect(settlementOf({ ...base, status: 'pending_payment' }, 100)).toBe('none');
  });
  it('予約時決済の返金は直販と同じく max(キャンセル料, 割引額) を差し引く・入湯税は必ず返す', () => {
    const paid = { ...base, payment_status: 'paid', payment_option: 'online', prepay_discount_amount: 5_200, paid_amount: 47_100 };
    expect(partnerRefundOf(paid, 15_600)).toEqual({ paid: 47_100, kept: 15_600, refund: 31_500 });
    expect(partnerRefundOf(paid, 0)).toEqual({ paid: 47_100, kept: 5_200, refund: 41_900 });
    expect(partnerRefundOf(paid, 0, true)).toEqual({ paid: 47_100, kept: 0, refund: 47_100 });
    expect(partnerRefundOf(paid, 99_999)).toEqual({ paid: 47_100, kept: 47_100, refund: 0 });
  });
});

describe('無料の最終日', () => {
  it('最初に料率がかかる日の前日', async () => {
    const { freeCancelUntil } = await import('./partner-cancel-fee');
    expect(freeCancelUntil('2026-10-12', policy)).toBe('2026-10-08');
    expect(freeCancelUntil('2026-10-12', { rules: [{ days_before: 0, rate_percent: 50 }], noShowPercent: null })).toBe('2026-10-11');
    expect(freeCancelUntil('2026-10-12', null)).toBeNull();
  });
});
