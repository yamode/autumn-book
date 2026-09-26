// 会員／非会員で支払方法を分ける（2026-09-27・book.plan_contents.nonmember_payment_method）。
// 純関数のみ（テスト: member-payment.test.ts）。
//   会員   = ログインしていて book.members に行がある人（locals.user.role === 'member'）
//   非会員 = それ以外。プランに非会員の設定があればそれを使い、無ければ会員と同じ。
import type { PaymentConfig, PaymentMethods } from '$lib/types';

/** payment_method（onsite / prepayment / deposit）→ 支払方法。不明な値は null */
export function paymentMethodsOf(pm: unknown): PaymentMethods | null {
	switch (pm) {
		case 'prepayment':
			return { onsite: false, prepay: true, prepayMethods: ['card'] };
		case 'deposit':
			return { onsite: true, prepay: true, prepayMethods: ['card'] };
		case 'onsite':
			return { onsite: true, prepay: false, prepayMethods: [] };
		default:
			return null;
	}
}

/**
 * 閲覧者（会員かどうか）に合わせた支払設定。
 * 非会員で nonMember があれば onsite / prepay / prepayMethods を差し替える。
 * 予約時決済が無くなる場合は、割引・早期決済割の表示用の値も消す（出さない）。
 */
export function paymentFor<T extends PaymentConfig>(payment: T, isMember: boolean): T {
	if (isMember || !payment.nonMember) return payment;
	const nm = payment.nonMember;
	const next: T = { ...payment, onsite: nm.onsite, prepay: nm.prepay, prepayMethods: [...nm.prepayMethods] };
	if (!nm.prepay) {
		next.prepayDiscountRate = 0;
		delete next.earlyPrepayMaxRate;
		delete next.earlyPrepayMode;
	}
	return next;
}

/** プランの payment を閲覧者に合わせたコピー（元のプランは書き換えない。デモの store はプランを共有しているため） */
export function planForViewer<P extends { payment: PaymentConfig }>(plan: P, isMember: boolean): P {
	const payment = paymentFor(plan.payment, isMember);
	return payment === plan.payment ? plan : { ...plan, payment };
}

/** 非会員には現地払いが無いが、会員なら現地払いを選べる（「会員の方は現地払いも…」の案内を出すか） */
export function memberOnsiteHint(payment: PaymentConfig, isMember: boolean): boolean {
	if (isMember || !payment.nonMember) return false;
	return payment.onsite && !payment.nonMember.onsite;
}
