import * as m from '$lib/paraglide/messages';
import { RATE_RULES, clientIp, ipKey, rateCheck, rateHit } from '$lib/server/login-rate-limit';

type CouponEvent = { platform?: App.Platform; request: Request };

/** クーポンコードの失敗が続いて止めているか（会員・IP のどちらか。2026-11-23 レビュー M-8） */
export async function couponLocked(event: CouponEvent, memberUserId: string | null | undefined): Promise<boolean> {
	const ip = ipKey(clientIp(event.request));
	const [byMember, byIp] = await Promise.all([
		memberUserId ? rateCheck(event.platform, RATE_RULES.couponMember, memberUserId) : Promise.resolve({ locked: false }),
		rateCheck(event.platform, RATE_RULES.couponIp, ip)
	]);
	return byMember.locked || byIp.locked;
}

/** 使えないクーポンコードだった（当たり外れの総当たりを数える） */
export async function couponFailed(event: CouponEvent, memberUserId: string | null | undefined): Promise<void> {
	const ip = ipKey(clientIp(event.request));
	await Promise.all([
		memberUserId ? rateHit(event.platform, RATE_RULES.couponMember, memberUserId) : Promise.resolve(),
		rateHit(event.platform, RATE_RULES.couponIp, ip)
	]);
}

export type BookingCoupon = { code: string; amount: number };

export function bookingCouponFrom(form: FormData): BookingCoupon | null {
	const code = String(form.get('couponCode') ?? '').trim().toUpperCase();
	if (!code) return null;
	const amount = Number(form.get('couponAmount'));
	return { code, amount: Number.isSafeInteger(amount) && amount > 0 ? amount : 0 };
}

export const couponErrors = ['coupon_invalid', 'coupon_amount_changed', 'coupon_not_compatible'] as const;

export function couponErrorText(code: string) {
	if (code === 'coupon_locked') return m.booking_coupon_locked();
	if (code === 'coupon_amount_changed') return m.booking_coupon_changed();
	if (code === 'coupon_not_compatible') return m.booking_coupon_not_compatible();
	return m.booking_coupon_invalid();
}
