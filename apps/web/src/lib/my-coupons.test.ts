import { describe, expect, it } from 'vitest';
import { couponsForBooking, mapMyCoupon, type MyCoupon } from './my-coupons';

const row = (o: Record<string, unknown> = {}) => ({
	id: 'c1', state: 'usable', code: 'WINTER', name: '冬の割引', description: null, discount_type: 'percent', discount_value: 10,
	min_total: 0, valid_from: '2026-11-01', valid_until: '2026-12-31', stay_from: null, stay_until: null,
	facility_id: null, facility_name: null, issued_at: '2026-11-24T00:00:00Z', used_at: null, ...o
});

describe('mapMyCoupon', () => {
	it('RPC の行を読み替える', () => {
		const c = mapMyCoupon(row())!;
		expect(c).toMatchObject({ id: 'c1', state: 'usable', code: 'WINTER', discountType: 'percent', discountValue: 10, minTotal: 0 });
	});
	it('使えない状態ならコードは持たない（RPC が返しても捨てる）', () => {
		expect(mapMyCoupon(row({ state: 'used', code: 'WINTER' }))!.code).toBeNull();
	});
	it('知らない状態は unavailable に倒す', () => {
		expect(mapMyCoupon(row({ state: 'weird' }))!.state).toBe('unavailable');
	});
	it('形が崩れた行は捨てる', () => {
		expect(mapMyCoupon({ name: 'x' })).toBeNull();
	});
});

describe('couponsForBooking', () => {
	const list = [
		row({ id: 'all' }),
		row({ id: 'oga', facility_id: 'F-OGA' }),
		row({ id: 'nishi', facility_id: 'F-NISHI' }),
		row({ id: 'used', state: 'used' }),
		row({ id: 'nocode', code: null }),
		row({ id: 'winter-only', stay_from: '2026-12-20', stay_until: '2027-01-05' })
	].map((r) => mapMyCoupon(r)!) as MyCoupon[];

	it('いま使えて、コードがあり、この施設で使えるものだけ', () => {
		expect(couponsForBooking(list, 'F-OGA', '2026-12-01').map((c) => c.id)).toEqual(['all', 'oga']);
	});
	it('対象のご宿泊の期間に入っていれば出す', () => {
		expect(couponsForBooking(list, 'F-OGA', '2026-12-25').map((c) => c.id)).toEqual(['all', 'oga', 'winter-only']);
	});
});
