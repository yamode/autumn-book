// 会員本人に配られたクーポン（book.my_coupons・autumn-shared 20261124063302）の型と純関数（2026-11-24）。
// マイページ「クーポン」と予約画面（お持ちのクーポンから選ぶ）で使う。

/** usable=いま使える / upcoming=使える期間の前 / used / expired / revoked / unavailable=運営が無効にした */
export type MyCouponState = 'usable' | 'upcoming' | 'used' | 'expired' | 'revoked' | 'unavailable';

export type MyCoupon = {
	id: string;
	state: MyCouponState;
	/** state=usable のときだけ入る */
	code: string | null;
	name: string;
	description: string | null;
	discountType: 'percent' | 'fixed';
	discountValue: number;
	minTotal: number;
	validFrom: string | null;
	validUntil: string | null;
	stayFrom: string | null;
	stayUntil: string | null;
	/** null は全施設で使える */
	facilityId: string | null;
	facilityName: string | null;
	issuedAt: string;
	usedAt: string | null;
};

const STATES: MyCouponState[] = ['usable', 'upcoming', 'used', 'expired', 'revoked', 'unavailable'];

/** RPC の1行を MyCoupon にする。形が崩れた行は捨てる */
export function mapMyCoupon(r: Record<string, unknown>): MyCoupon | null {
	if (!r || typeof r.id !== 'string' || typeof r.name !== 'string') return null;
	const state = STATES.includes(r.state as MyCouponState) ? (r.state as MyCouponState) : 'unavailable';
	const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
	return {
		id: r.id,
		state,
		code: state === 'usable' ? str(r.code) : null,
		name: r.name,
		description: str(r.description),
		discountType: r.discount_type === 'percent' ? 'percent' : 'fixed',
		discountValue: Number(r.discount_value) || 0,
		minTotal: Number(r.min_total) || 0,
		validFrom: str(r.valid_from),
		validUntil: str(r.valid_until),
		stayFrom: str(r.stay_from),
		stayUntil: str(r.stay_until),
		facilityId: str(r.facility_id),
		facilityName: str(r.facility_name),
		issuedAt: String(r.issued_at ?? ''),
		usedAt: str(r.used_at)
	};
}

/**
 * 予約画面で「お持ちのクーポン」として出すもの: いま使えて、コードがあり、この施設で使えるもの。
 * 宿泊日・最低金額などの細かい条件は、選んだあとに DB（member_coupon_code_quote）が確かめる。
 * ここで宿泊日だけは先に絞る（明らかに使えないものを並べない）。
 */
export function couponsForBooking(list: readonly MyCoupon[], facilityId: string, checkin: string): MyCoupon[] {
	return list.filter(
		(c) =>
			c.state === 'usable' &&
			!!c.code &&
			(!c.facilityId || c.facilityId === facilityId) &&
			(!c.stayFrom || checkin >= c.stayFrom) &&
			(!c.stayUntil || checkin <= c.stayUntil)
	);
}
