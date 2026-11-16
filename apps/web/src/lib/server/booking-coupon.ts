import * as m from '$lib/paraglide/messages';

export type BookingCoupon = { code: string; amount: number };

export function bookingCouponFrom(form: FormData): BookingCoupon | null {
	const code = String(form.get('couponCode') ?? '').trim().toUpperCase();
	if (!code) return null;
	const amount = Number(form.get('couponAmount'));
	return { code, amount: Number.isSafeInteger(amount) && amount > 0 ? amount : 0 };
}

export const couponErrors = ['coupon_invalid', 'coupon_amount_changed', 'coupon_not_compatible'] as const;

export function couponErrorText(code: string) {
	if (code === 'coupon_amount_changed') return m.booking_coupon_changed();
	if (code === 'coupon_not_compatible') return m.booking_coupon_not_compatible();
	return m.booking_coupon_invalid();
}
