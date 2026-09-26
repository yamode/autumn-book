// 早期決済割の表示用（予約確認画面・プラン一覧・取消の返金見込み）のテスト。
// 式そのものは lib/early-prepay.test.ts。ここは画面に出す段階表・「あと N 日で」・最大率・返金見込みの組み立て。
import { describe, expect, it } from 'vitest';
import { DEFAULT_EARLY_PREPAY_TIERS, type EarlyPrepaySettings } from '$lib/early-prepay';
import type { PaymentConfig } from '$lib/types';
import { directRefundPreviewOf, prepayDiscountViewOf, withEarlyPrepayMax } from './direct-payments';

const ON: EarlyPrepaySettings = { enabled: true, tiers: DEFAULT_EARLY_PREPAY_TIERS, blackouts: [] };
const pay = (p: Partial<PaymentConfig> = {}): { payment: PaymentConfig } => ({
  payment: { onsite: true, prepay: true, prepayMethods: ['card'], prepayDiscountRate: 0, earlyPrepay: true, ...p }
});
const hold = (checkin: string, total = 60000) => ({ checkin, quote: { total, lines: [{ date: checkin, subtotal: total }] } });

describe('prepayDiscountViewOf', () => {
  it('92日前は 5%・段階表を出す', () => {
    const v = prepayDiscountViewOf(ON, pay(), hold('2027-01-01'), '2026-10-01');
    expect(v.detail.leadDays).toBe(92);
    expect(v.detail.discount).toBe(3000);
    expect(v.showLadder).toBe(true);
    expect(v.early).toBe(true);
    expect(v.tiers.map((t) => t.days)).toEqual([30, 90, 180]);
    expect(v.drop).toEqual({ inDays: 3, fromPercent: 5, toPercent: 3, diff: 1200 });
  });

  it('境界の7日以内だけ「あと N 日で 5% → 3%」と差額を出す', () => {
    expect(prepayDiscountViewOf(ON, pay(), hold('2027-01-01'), '2026-09-27').drop).toEqual({ inDays: 7, fromPercent: 5, toPercent: 3, diff: 1200 }); // 96日前
    expect(prepayDiscountViewOf(ON, pay(), hold('2027-01-01'), '2026-09-26').drop).toBeNull(); // 97日前
  });

  it('最後の段（3%）から外れるときは 0% との差', () => {
    const v = prepayDiscountViewOf(ON, pay(), hold('2026-11-01'), '2026-09-30'); // 32日前
    expect(v.drop).toEqual({ inDays: 3, fromPercent: 3, toPercent: 0, diff: 1800 });
  });

  it('定率の方が大きいプランは段階表を出さず、割引は定率', () => {
    const v = prepayDiscountViewOf(ON, pay({ prepayDiscountRate: 0.1 }), hold('2027-06-01'), '2026-10-01');
    expect(v.showLadder).toBe(false);
    expect(v.early).toBe(false);
    expect(v.detail.discount).toBe(6000);
  });

  it('対象外プラン・施設で OFF は段階表なし（定率だけ）', () => {
    expect(prepayDiscountViewOf(ON, pay({ earlyPrepay: false }), hold('2027-06-01'), '2026-10-01').detail.discount).toBe(0);
    expect(prepayDiscountViewOf({ ...ON, enabled: false }, pay(), hold('2027-06-01'), '2026-10-01').showLadder).toBe(false);
  });

  it('除外期間の泊は段階表を当てない（泊数を数える）', () => {
    const s = { ...ON, blackouts: [{ from: '2026-12-29', to: '2027-01-03', label: '年末年始' }] };
    const v = prepayDiscountViewOf(s, pay(), hold('2027-01-01'), '2026-10-01');
    expect(v.detail.blackoutNights).toBe(1);
    expect(v.detail.discount).toBe(0);
    expect(v.showLadder).toBe(true);
  });
});

describe('withEarlyPrepayMax', () => {
  it('対象プランに段階表の最大率を入れ、定率の方が大きいプラン・対象外は触らない', () => {
    const plans = [pay(), pay({ prepayDiscountRate: 0.1 }), pay({ earlyPrepay: false }), pay({ prepay: false })];
    const out = withEarlyPrepayMax(plans, ON);
    expect(out.map((p) => p.payment.earlyPrepayMaxRate)).toEqual([0.08, undefined, undefined, undefined]);
    // 元のプランは書き換えない
    expect(plans[0].payment.earlyPrepayMaxRate).toBeUndefined();
  });

  it('施設で OFF なら何もしない', () => {
    const plans = [pay()];
    expect(withEarlyPrepayMax(plans, { ...ON, enabled: false })).toBe(plans);
  });
});

describe('directRefundPreviewOf', () => {
  const paid = { amount: 57300, prepay_discount_amount: 3000, refunded_amount: 0 };

  it('キャンセル料が割引より小さいときは割引額を差し引く（返金しない割引額）', () => {
    expect(directRefundPreviewOf(paid, 0)).toEqual({ paid: 57300, fee: 0, discount: 3000, deducted: 3000, kept: 3000, refund: 54300 });
    expect(directRefundPreviewOf(paid, 1000)).toEqual({ paid: 57300, fee: 1000, discount: 3000, deducted: 3000, kept: 2000, refund: 54300 });
  });

  it('キャンセル料の方が大きければキャンセル料だけ', () => {
    expect(directRefundPreviewOf(paid, 30000)).toEqual({ paid: 57300, fee: 30000, discount: 3000, deducted: 30000, kept: 0, refund: 27300 });
  });

  it('返金しない割引額は入湯税を除いた支払額まで（入湯税は必ず返す）', () => {
    // ポイントで宿泊料金をほぼ払った予約: 支払額 1,300（うち入湯税 300）・割引 3,000
    expect(directRefundPreviewOf({ amount: 1300, bath_tax_amount: 300, prepay_discount_amount: 3000, refunded_amount: 0 }, 0)).toEqual({
      paid: 1300,
      fee: 0,
      discount: 3000,
      deducted: 1000,
      kept: 1000,
      refund: 300
    });
  });

  it('施設都合（免除）は全額返金・割引のない予約は従来どおり', () => {
    expect(directRefundPreviewOf(paid, 30000, true).refund).toBe(57300);
    expect(directRefundPreviewOf({ amount: 30300, refunded_amount: 0 }, 15000)).toEqual({ paid: 30300, fee: 15000, discount: 0, deducted: 15000, kept: 0, refund: 15300 });
  });
});
