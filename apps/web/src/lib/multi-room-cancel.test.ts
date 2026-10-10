// 部屋ごとの取消（M2）の純関数のテスト。金額は DB（book._room_cancel_kept・direct_payment_refund_due）を
// 使い捨てコンテナで流した結果と同じ値（docs/official-multi-room.md §16）。`pnpm --filter @autumn-book/web test`
import { describe, expect, it } from 'vitest';
import { liveRooms, remainingRefundPreview, roomRefundPreview, roomsStatus } from './multi-room';

// オンライン決済 2 室: 1 室目 和室 60,000（予約時決済割 3,000・入湯税 300）＝支払分 57,300、
//                     2 室目 洋室 20,000（割引なし・入湯税 150）＝支払分 20,150。請求額 77,450・事務手数料 5%
const room1 = { paidShare: 57300, bathTax: 300, prepayDiscount: 3000 };
const room2 = { paidShare: 20150, bathTax: 150, prepayDiscount: 0 };
const terms = { adminFeePercent: 5 };

describe('roomRefundPreview（1 室の返金見込み・_room_cancel_kept と同じ式）', () => {
	it('事務手数料がいちばん大きい: 20,150 × 5% = 1,007 を差し引いて 19,143', () => {
		const p = roomRefundPreview(room2, 0, terms);
		expect(p.deducted).toBe(1007);
		expect(p.refund).toBe(19143);
		expect(p.reason).toBe('admin_fee');
	});

	it('予約時決済割がいちばん大きい: 3,000 を差し引いて 54,300', () => {
		const p = roomRefundPreview(room1, 0, terms);
		expect(p.deducted).toBe(3000);
		expect(p.refund).toBe(54300);
		expect(p.reason).toBe('prepay_discount');
	});

	it('キャンセル料がいちばん大きい（支払分まで）', () => {
		const p = roomRefundPreview(room1, 18000, terms);
		expect(p.deducted).toBe(18000);
		expect(p.refund).toBe(39300);
		expect(p.reason).toBe('cancel_fee');
		expect(roomRefundPreview(room2, 99999, terms).refund).toBe(0);
	});

	it('免除（施設都合）は割引も返す。事務手数料は adminFeeWaived のときだけ返す', () => {
		expect(roomRefundPreview(room1, 18000, { ...terms, waived: true }).deducted).toBe(2865);
		expect(roomRefundPreview(room1, 18000, { ...terms, waived: true, adminFeeWaived: true }).refund).toBe(57300);
	});

	it('事務手数料・割引は入湯税を除いた支払分まで（入湯税は必ず返す）', () => {
		const p = roomRefundPreview({ paidShare: 1150, bathTax: 150, prepayDiscount: 5000 }, 0, terms);
		expect(p.deducted).toBe(1000);
		expect(p.refund).toBe(150);
	});
});

describe('remainingRefundPreview（残りの部屋をすべて取り消したときの返金見込み）', () => {
	const pay = { amount: 77450, refunded: 0, bathTax: 450, prepayDiscount: 3000 };

	it('まだ 1 室も取り消していない予約は従来の式（請求額全体の事務手数料 3,872）', () => {
		const p = remainingRefundPreview(pay, [{ ...room1, fee: 0 }, { ...room2, fee: 0 }], [], terms);
		expect(p.deducted).toBe(3872);
		expect(p.refund).toBe(73578);
	});

	it('2 室目を取り消して返金済み → 残りの 1 室目は部屋の見込みそのもの', () => {
		const p = remainingRefundPreview({ ...pay, refunded: 19143 }, [{ ...room1, fee: 0 }], [{ cancelKept: 1007 }], terms);
		expect(p.refund).toBe(54300);
		expect(p.deducted).toBe(3000);
	});

	it('前の部屋の返金がまだ（失敗など）なら、その分も足して返す', () => {
		const p = remainingRefundPreview(pay, [{ ...room1, fee: 0 }], [{ cancelKept: 1007 }], terms);
		expect(p.refund).toBe(54300 + 19143);
	});

	it('1 室の予約は 1 室の見込みと同じ額', () => {
		const one = { amount: 57300, refunded: 0, bathTax: 300, prepayDiscount: 3000 };
		expect(remainingRefundPreview(one, [{ ...room1, fee: 6000 }], [], terms).refund).toBe(
			roomRefundPreview(room1, 6000, terms).refund
		);
	});
});

describe('roomsStatus・liveRooms', () => {
	it('代表の 1 室目を取り消しても、生きている部屋があれば予約中', () => {
		const rooms = [
			{ cancelled: true, stayStatus: 'cancelled' },
			{ cancelled: false, stayStatus: 'reserved' }
		];
		expect(roomsStatus('confirmed', rooms)).toBe('reserved');
		expect(liveRooms(rooms)).toHaveLength(1);
	});

	it('予約が取消・生きている部屋が無い → cancelled。泊まり終えた部屋があれば stayed', () => {
		expect(roomsStatus('cancelled', [{ cancelled: false, stayStatus: 'reserved' }])).toBe('cancelled');
		expect(roomsStatus('confirmed', [{ cancelled: true }])).toBe('cancelled');
		expect(roomsStatus('confirmed', [{ cancelled: false, stayStatus: 'checked_out' }])).toBe('stayed');
	});
});
