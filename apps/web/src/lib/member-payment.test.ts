// 会員／非会員の支払方法（book.plan_contents.nonmember_payment_method）のテスト。`pnpm --filter @autumn-book/web test`
import { describe, expect, it } from 'vitest';
import { memberOnsiteHint, paymentFor, paymentMethodsOf, planForViewer } from './member-payment';
import { payOptionsFor } from './direct-payment';
import type { PaymentConfig } from './types';

// 会員は deposit（予約時決済か現地払い）、非会員は prepayment（予約時決済のみ）
const depositWithGuestPrepay: PaymentConfig = {
	onsite: true,
	prepay: true,
	prepayMethods: ['card'],
	prepayDiscountRate: 0.1,
	earlyPrepay: true,
	earlyPrepayMaxRate: 0.15,
	earlyPrepayMode: 'discount',
	nonMember: { onsite: false, prepay: true, prepayMethods: ['card'] }
};

describe('payment_method → 支払方法', () => {
	it('onsite / prepayment / deposit を読み、不明・null は null（＝会員と同じ）', () => {
		expect(paymentMethodsOf('onsite')).toEqual({ onsite: true, prepay: false, prepayMethods: [] });
		expect(paymentMethodsOf('prepayment')).toEqual({ onsite: false, prepay: true, prepayMethods: ['card'] });
		expect(paymentMethodsOf('deposit')).toEqual({ onsite: true, prepay: true, prepayMethods: ['card'] });
		expect(paymentMethodsOf(null)).toBeNull();
		expect(paymentMethodsOf(undefined)).toBeNull();
		expect(paymentMethodsOf('other')).toBeNull();
	});
});

describe('閲覧者に合わせた支払設定', () => {
	it('会員はプランの設定のまま', () => {
		expect(paymentFor(depositWithGuestPrepay, true)).toBe(depositWithGuestPrepay);
	});
	it('非会員は非会員の設定（予約時決済のみ）。割引・早期決済割はそのまま', () => {
		const p = paymentFor(depositWithGuestPrepay, false);
		expect(p.onsite).toBe(false);
		expect(p.prepay).toBe(true);
		expect(p.prepayDiscountRate).toBe(0.1);
		expect(p.earlyPrepayMaxRate).toBe(0.15);
		// 現地払いは出さない（オンライン決済が使えるとき）
		expect(payOptionsFor(p, { live: true, onlineReady: true })).toEqual({ options: ['card'], fallback: false });
		// オンライン決済が使えない環境では既存どおり現地払いで受ける
		expect(payOptionsFor(p, { live: true, onlineReady: false })).toEqual({ options: ['onsite'], fallback: true });
	});
	it('非会員の設定が無ければ会員と同じ', () => {
		const { nonMember: _, ...same } = depositWithGuestPrepay;
		expect(paymentFor(same, false)).toBe(same);
	});
	it('非会員が現地払いのみなら、割引・早期決済割の表示を消す', () => {
		const p = paymentFor({ ...depositWithGuestPrepay, nonMember: { onsite: true, prepay: false, prepayMethods: [] } }, false);
		expect(p).toMatchObject({ onsite: true, prepay: false, prepayMethods: [], prepayDiscountRate: 0 });
		expect(p.earlyPrepayMaxRate).toBeUndefined();
		expect(p.earlyPrepayMode).toBeUndefined();
	});
	it('元のプランは書き換えない', () => {
		const plan = { id: 'x', payment: depositWithGuestPrepay };
		const viewed = planForViewer(plan, false);
		expect(viewed).not.toBe(plan);
		expect(viewed.payment.onsite).toBe(false);
		expect(plan.payment.onsite).toBe(true);
		expect(planForViewer(plan, true)).toBe(plan);
	});
});

describe('「会員の方は現地払いも選べます」の案内', () => {
	it('非会員は予約時決済のみ・会員は現地払いも可のときだけ出す', () => {
		expect(memberOnsiteHint(depositWithGuestPrepay, false)).toBe(true);
		expect(memberOnsiteHint(depositWithGuestPrepay, true)).toBe(false);
		expect(memberOnsiteHint({ ...depositWithGuestPrepay, nonMember: undefined }, false)).toBe(false);
		expect(memberOnsiteHint({ ...depositWithGuestPrepay, nonMember: { onsite: true, prepay: true, prepayMethods: ['card'] } }, false)).toBe(false);
	});
});
