// 早期決済割の純関数のテスト（SQL の book._early_prepay_discount と同じ式）。`pnpm --filter @autumn-book/web test`
import { describe, expect, it } from 'vitest';
import {
  nextTierDrop,
  normalizeEarlyPrepaySettings,
  prepayDiscountDetail,
  tierPermilleOf,
  validateEarlyPrepaySettings,
  type EarlyPrepaySettings
} from './early-prepay';
import { directRefundDueOf } from './direct-payment';

// 計算の検証用の段階表（推奨値とは別に固定。推奨値を変えてもテストが動かないように）
const TIERS = [{ days: 30, percent: 3 }, { days: 90, percent: 5 }, { days: 180, percent: 8 }];
const ON: EarlyPrepaySettings = { enabled: true, mode: 'discount', tiers: TIERS, blackouts: [] };
const POINTS: EarlyPrepaySettings = { ...ON, mode: 'points' };
const lines = (from: string, n: number, sub: number) =>
  Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10), subtotal: sub }));

describe('段階表の率', () => {
  it('日数が段の days 以上なら、その段の率（千分率）', () => {
    expect(tierPermilleOf(TIERS, 29)).toBe(0);
    expect(tierPermilleOf(TIERS, 30)).toBe(30);
    expect(tierPermilleOf(TIERS, 89)).toBe(30);
    expect(tierPermilleOf(TIERS, 90)).toBe(50);
    expect(tierPermilleOf(TIERS, 400)).toBe(80);
    expect(tierPermilleOf([{ days: 10, percent: 2.5 }], 10)).toBe(25);
  });
});

describe('割引額', () => {
  it('3カ月先・2泊（各 30,000円）→ 5%', () => {
    const d = prepayDiscountDetail({
      total: 60000, lines: lines('2027-01-10', 2, 30000), checkIn: '2027-01-10', today: '2026-10-01',
      flatRate: 0, earlyEligible: true, settings: ON
    });
    expect(d.leadDays).toBe(101);
    expect(d.discount).toBe(3000);
    expect(d.maxPermille).toBe(50);
  });
  it('OFF・対象外プラン・直前は定率だけ（定率だけなら従来の floor(宿泊料金 × 率) と同じ）', () => {
    const base = { total: 33333, lines: [{ date: '2027-01-10', subtotal: 33333 }], checkIn: '2027-01-10', today: '2026-10-01', flatRate: 0.15 };
    expect(prepayDiscountDetail({ ...base, earlyEligible: true, settings: { ...ON, enabled: false } }).discount).toBe(4999);
    expect(prepayDiscountDetail({ ...base, flatRate: 0, earlyEligible: false, settings: ON }).discount).toBe(0);
    expect(prepayDiscountDetail({ ...base, flatRate: 0, earlyEligible: true, today: '2027-01-01', settings: ON }).discount).toBe(0);
  });
  it('定率と段階表は大きい方（足し算しない）', () => {
    const q = { total: 10000, lines: [{ date: '2027-06-01', subtotal: 10000 }], checkIn: '2027-06-01', today: '2026-10-01', earlyEligible: true, settings: ON };
    expect(prepayDiscountDetail({ ...q, flatRate: 0.05 }).discount).toBe(800); // 8% > 5%
    expect(prepayDiscountDetail({ ...q, flatRate: 0.1 }).discount).toBe(1000); // 10% > 8%
  });
  it('除外期間の泊は段階表を当てない（泊ごと）', () => {
    const s = { ...ON, blackouts: [{ from: '2027-01-01', to: '2027-01-01', label: '元日' }] };
    const d = prepayDiscountDetail({
      total: 60000, lines: lines('2026-12-31', 2, 30000), checkIn: '2026-12-31', today: '2026-09-01',
      flatRate: 0, earlyEligible: true, settings: s
    });
    expect(d.discount).toBe(1500); // 12/31 だけ 5%
    expect(d.blackoutNights).toBe(1);
  });
  it('明細が無いときは宿泊初日で判定', () => {
    expect(prepayDiscountDetail({ total: 12345, checkIn: '2027-06-01', today: '2026-10-01', flatRate: 0, earlyEligible: true, settings: ON }).discount).toBe(987);
  });
});

describe('ポイントモード（早期決済ポイント）', () => {
  it('段階表の率は割引にせずポイントに（税抜 ÷1.10・切り捨て）', () => {
    const d = prepayDiscountDetail({
      total: 60000, lines: lines('2027-01-10', 2, 30000), checkIn: '2027-01-10', today: '2026-10-01',
      flatRate: 0, earlyEligible: true, settings: POINTS
    });
    expect(d.mode).toBe('points');
    expect(d.discount).toBe(0);
    expect(d.bonusPoints).toBe(2727); // 60000 × 5% ÷ 1.10 = 2727.27
    expect(d.pointsPermille).toBe(50);
  });
  it('プランの定率割引はそのまま割引、段階表はポイント（両方つく）', () => {
    const d = prepayDiscountDetail({
      total: 10000, lines: [{ date: '2027-06-01', subtotal: 10000 }], checkIn: '2027-06-01', today: '2026-10-01',
      flatRate: 0.05, earlyEligible: true, settings: POINTS
    });
    expect(d.discount).toBe(500);
    expect(d.bonusPoints).toBe(727); // 10000 × 8% ÷ 1.10
  });
  it('除外期間の泊・OFF・対象外はポイントなし', () => {
    const s = { ...POINTS, blackouts: [{ from: '2027-01-11', to: '2027-01-11', label: '' }] };
    const base = { total: 60000, lines: lines('2027-01-10', 2, 30000), checkIn: '2027-01-10', today: '2026-10-01', flatRate: 0 };
    expect(prepayDiscountDetail({ ...base, earlyEligible: true, settings: s }).bonusPoints).toBe(1363); // 1泊分
    expect(prepayDiscountDetail({ ...base, earlyEligible: false, settings: POINTS }).bonusPoints).toBe(0);
    expect(prepayDiscountDetail({ ...base, earlyEligible: true, settings: { ...POINTS, enabled: false } }).mode).toBe('discount');
  });
});

describe('段が下がる案内', () => {
  it('境界の7日以内だけ', () => {
    expect(nextTierDrop(TIERS, 92)).toEqual({ inDays: 3, fromPercent: 5, toPercent: 3 });
    expect(nextTierDrop(TIERS, 30)).toEqual({ inDays: 1, fromPercent: 3, toPercent: 0 });
    expect(nextTierDrop(TIERS, 100)).toBeNull();
    expect(nextTierDrop(TIERS, 10)).toBeNull();
  });
});

describe('設定の検証', () => {
  it('日数・率とも昇順', () => {
    expect(validateEarlyPrepaySettings(ON)).toBeNull();
    expect(validateEarlyPrepaySettings({ ...ON, tiers: [{ days: 90, percent: 5 }, { days: 30, percent: 8 }] })).toMatch(/日数/);
    expect(validateEarlyPrepaySettings({ ...ON, tiers: [{ days: 30, percent: 5 }, { days: 90, percent: 5 }] })).toMatch(/割引率/);
    expect(validateEarlyPrepaySettings({ ...ON, tiers: [{ days: 30, percent: 25 }] })).toMatch(/1〜20%/);
    expect(validateEarlyPrepaySettings({ ...ON, tiers: [] })).toMatch(/1つ以上/);
    expect(validateEarlyPrepaySettings({ ...ON, blackouts: [{ from: '2027-01-05', to: '2027-01-01', label: '' }] })).toMatch(/終了日/);
  });
  it('DB の列名でも読める', () => {
    expect(normalizeEarlyPrepaySettings({ early_prepay_enabled: true, early_prepay_tiers: [{ days: '30', percent: '3' }], early_prepay_blackouts: [] })).toEqual({
      enabled: true, mode: 'discount', tiers: [{ days: 30, percent: 3 }], blackouts: []
    });
  });
});

describe('取消後の返金（割引額は返金しない）', () => {
  it('規定のキャンセル料が割引額より小さいときは割引額を差し引く', () => {
    expect(directRefundDueOf({ amount: 57300, fee: 0, prepayDiscount: 3000 })).toBe(54300);
    expect(directRefundDueOf({ amount: 57300, fee: 30000, prepayDiscount: 3000 })).toBe(27300);
  });
  it('キャンセル料を免除した取消（施設都合）は全額返金', () => {
    expect(directRefundDueOf({ amount: 57300, fee: 0, prepayDiscount: 3000, waived: true })).toBe(57300);
  });
  it('ポイントで支払額が小さくても入湯税は返す', () => {
    // total 10,000・割引 800・ポイント 9,300・入湯税 150 → 支払 850。差し引けるのは 700 まで
    expect(directRefundDueOf({ amount: 850, fee: 0, prepayDiscount: 800, bathTax: 150 })).toBe(150);
    expect(directRefundDueOf({ amount: 1150, fee: 0, prepayDiscount: 800, bathTax: 150 })).toBe(350);
  });
  it('一部返金済みは差し引く', () => {
    expect(directRefundDueOf({ amount: 57300, fee: 0, prepayDiscount: 3000, refunded: 10000 })).toBe(44300);
  });
});

describe('明細の合計と宿泊料金が違うとき（加重平均・整数の切り捨て）', () => {
  it('SQL の ((total * Σ小計×率) / (Σ小計 × 1000)) と同じ', () => {
    const d = prepayDiscountDetail({
      total: 70001,
      lines: [{ date: '2027-01-10', subtotal: 30000 }, { date: '2027-01-11', subtotal: 30001 }],
      checkIn: '2027-01-10', today: '2026-10-01', flatRate: 0.03, earlyEligible: true,
      settings: { ...ON, blackouts: [{ from: '2027-01-11', to: '2027-01-11', label: '' }] }
    });
    // 泊の率: 50‰ / 30‰ → Σ = 30000×50 + 30001×30 = 2,400,030。70001×2400030 / (60001×1000) = 2800.05… → 2800
    expect(d.discount).toBe(2800);
  });
  it('計算済みの割引額を請求額に使える', async () => {
    const { directChargeOf } = await import('./direct-payment');
    expect(directChargeOf({ total: 60000, bathTax: 300, prepayDiscount: 3000 })).toEqual({ lodging: 60000, bathTax: 300, discount: 3000, charge: 57300 });
  });
});
