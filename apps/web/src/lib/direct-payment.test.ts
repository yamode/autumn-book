// 公式サイト予約のオンライン決済（v0.43.0）の純関数のテスト。`pnpm --filter @autumn-book/web test`
import { describe, expect, it } from 'vitest';
import { directChargeOf, directRefundDueOf, payOptionsFor } from './direct-payment';

describe('請求額（宿泊料金 − ポイント ＋ 入湯税）', () => {
	it('入湯税を足す', () => {
		expect(directChargeOf({ total: 30000, bathTax: 300 })).toEqual({ lodging: 30000, bathTax: 300, discount: 0, charge: 30300 });
	});
	it('ポイントは宿泊料金から引く（入湯税には使わない）', () => {
		expect(directChargeOf({ total: 30000, pointsUsed: 5000, bathTax: 300 })).toEqual({ lodging: 25000, bathTax: 300, discount: 0, charge: 25300 });
		// 宿泊料金を超えるポイントは宿泊料金まで
		expect(directChargeOf({ total: 30000, pointsUsed: 99999, bathTax: 300 }).charge).toBe(300);
		expect(directChargeOf({ total: 30000, pointsUsed: -5, bathTax: -1 })).toEqual({ lodging: 30000, bathTax: 0, discount: 0, charge: 30000 });
	});
});

describe('予約時決済割引（DB の direct_payment_prepare と同じ式）', () => {
	it('宿泊料金に割引率を掛けて円未満切り捨て。予約金額（lodging）は割引前のまま', () => {
		expect(directChargeOf({ total: 87200, bathTax: 300, prepayDiscountRate: 0.1 })).toEqual({ lodging: 87200, bathTax: 300, discount: 8720, charge: 78780 });
		expect(directChargeOf({ total: 33333, prepayDiscountRate: 0.15 }).discount).toBe(4999);
		expect(directChargeOf({ total: 30000, prepayDiscountRate: 0.07 }).discount).toBe(2100);
	});
	it('割引率は 0〜20% に丸める', () => {
		expect(directChargeOf({ total: 10000, prepayDiscountRate: 0.5 }).discount).toBe(2000);
		expect(directChargeOf({ total: 10000, prepayDiscountRate: -1 }).discount).toBe(0);
	});
	it('ポイントは割引後の宿泊料金まで', () => {
		expect(directChargeOf({ total: 30000, pointsUsed: 99999, bathTax: 300, prepayDiscountRate: 0.1 })).toEqual({ lodging: 3000, bathTax: 300, discount: 3000, charge: 300 });
	});
});

describe('取消後の返金額（支払額 − キャンセル料 − 返金済み）', () => {
	it('キャンセル料を差し引く（入湯税は返る）', () => {
		expect(directRefundDueOf({ amount: 30300, fee: 15000 })).toBe(15300);
		expect(directRefundDueOf({ amount: 30300, fee: 30000 })).toBe(300);
	});
	it('免除・0円なら全額、支払額を超えるキャンセル料なら 0', () => {
		expect(directRefundDueOf({ amount: 30300, fee: 0 })).toBe(30300);
		expect(directRefundDueOf({ amount: 25300, fee: 30000 })).toBe(0);
	});
	it('返金済みの分は引く', () => {
		expect(directRefundDueOf({ amount: 30300, fee: 15000, refunded: 10000 })).toBe(5300);
		expect(directRefundDueOf({ amount: 30300, fee: 0, refunded: 30300 })).toBe(0);
	});
});

describe('支払方法の選択肢', () => {
	const prepayment = { onsite: false, prepay: true, prepayMethods: ['card' as const] };
	const deposit = { onsite: true, prepay: true, prepayMethods: ['card' as const] };
	const onsite = { onsite: true, prepay: false, prepayMethods: [] };
	it('実データでオンライン決済が使えるとき', () => {
		expect(payOptionsFor(prepayment, { live: true, onlineReady: true })).toEqual({ options: ['card'], fallback: false });
		expect(payOptionsFor(deposit, { live: true, onlineReady: true })).toEqual({ options: ['card', 'onsite'], fallback: false });
		expect(payOptionsFor(onsite, { live: true, onlineReady: true })).toEqual({ options: ['onsite'], fallback: false });
	});
	it('使えないときは現地払い（事前決済だけのプランも現地払いで受ける）', () => {
		expect(payOptionsFor(prepayment, { live: true, onlineReady: false })).toEqual({ options: ['onsite'], fallback: true });
		expect(payOptionsFor(deposit, { live: true, onlineReady: false })).toEqual({ options: ['onsite'], fallback: false });
	});
	it('実データでは PayPay を出さない・デモは従来どおり', () => {
		const both = { onsite: true, prepay: true, prepayMethods: ['card' as const, 'paypay' as const] };
		expect(payOptionsFor(both, { live: true, onlineReady: true }).options).toEqual(['card', 'onsite']);
		expect(payOptionsFor(both, { live: false, onlineReady: false }).options).toEqual(['card', 'paypay', 'onsite']);
	});
});
