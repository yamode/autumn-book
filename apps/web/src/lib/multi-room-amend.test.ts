// 公式の複数室 M3（部屋ごとの部屋タイプ・プラン・人数の変更）の純関数のテスト（docs/official-multi-room.md §17・§18）
import { describe, expect, it } from 'vitest';
import {
	AMEND_ROOM_MESSAGES_JA,
	amendLimitOf,
	amendRoomErrorCode,
	amendRoomErrorStatus,
	amendRoomsPayload,
	canAmendRoomOf,
	mapAmendRoomsQuoteRooms,
	mapChangedRooms,
	parseAdults,
	policyRulesOf,
	type AmendRoomErrorCode
} from './multi-room';

describe('amendLimitOf（DB の book._amend_limit と同じ式: 2 + (室数 − 1)）', () => {
	it('1 室 2・2 室 3・3 室 4・4 室 5', () => {
		expect([1, 2, 3, 4].map(amendLimitOf)).toEqual([2, 3, 4, 5]);
	});
	it('0 室・不正な値は 1 室扱い、5 室以上は 4 室で頭打ち', () => {
		expect(amendLimitOf(0)).toBe(2);
		expect(amendLimitOf(Number.NaN)).toBe(2);
		expect(amendLimitOf(-3)).toBe(2);
		expect(amendLimitOf(9)).toBe(5);
		expect(amendLimitOf(2.7)).toBe(3);
	});
});

describe('amendRoomsPayload（RPC の p_rooms）', () => {
	it('UUID はそのまま・省いた値は送らない', () => {
		expect(amendRoomsPayload([{ index: 2, ratePlanId: 'p', roomTypeId: 'r', adults: 3 }, { index: 3, adults: 1 }])).toEqual([
			{ room_index: 2, rate_plan_id: 'p', room_type_id: 'r', adults: 3 },
			{ room_index: 3, adults: 1 }
		]);
	});
	it('専用ページはコード・泊明細・特典（null は空配列＝特典なし）。UUID があればコードより優先', () => {
		const lines = [{ date: '2026-11-09', unit_price: 16000, adults: 1, subtotal: 16000 }];
		expect(
			amendRoomsPayload([
				{ index: 1, ratePlanCode: 'P2■朝食のみ', roomTypeCode: 'YO', adults: 1, lines, memberPerks: null },
				{ index: 2, ratePlanId: 'uuid', ratePlanCode: 'X', roomTypeCode: 'WA', memberPerks: [{ id: 'p', title: '花束', description: '' }] }
			])
		).toEqual([
			{ room_index: 1, rate_plan_code: 'P2■朝食のみ', room_type_code: 'YO', adults: 1, lines, member_perks: [] },
			{ room_index: 2, rate_plan_id: 'uuid', room_type_code: 'WA', member_perks: [{ id: 'p', title: '花束', description: '' }] }
		]);
	});
	it('memberPerks を渡さなければ member_perks を送らない（プランが変わらない部屋の特典は DB が据え置く）', () => {
		expect(amendRoomsPayload([{ index: 1, roomTypeCode: 'YO' }])[0]).not.toHaveProperty('member_perks');
	});
});

describe('見積・電文の写像', () => {
	const changed = [
		{
			room_index: 2,
			stay_id: 's2',
			reservation_code: 'YB-2026-008001-2',
			before: { room_type_id: 'wa', room_type_name: '和室', rate_plan_id: 'p1', plan_code: 'P1', plan_name: '朝夕食', adults: 2, total: 120000 },
			after: { room_type_id: 'yo', room_type_name: '洋室', rate_plan_id: 'p2', plan_code: 'P2', plan_name: '朝食のみ', adults: 2, total: 80000 }
		}
	];
	it('mapChangedRooms', () => {
		expect(mapChangedRooms(changed)).toEqual([
			{
				index: 2,
				stayId: 's2',
				stayCode: 'YB-2026-008001-2',
				before: { roomTypeId: 'wa', roomTypeName: '和室', ratePlanId: 'p1', planCode: 'P1', planName: '朝夕食', adults: 2, total: 120000 },
				after: { roomTypeId: 'yo', roomTypeName: '洋室', ratePlanId: 'p2', planCode: 'P2', planName: '朝食のみ', adults: 2, total: 80000 }
			}
		]);
		expect(mapChangedRooms(null)).toEqual([]);
	});
	it('mapAmendRoomsQuoteRooms（コンテナで出た 3 室の見積の 2 室目）', () => {
		const [r] = mapAmendRoomsQuoteRooms([
			{
				room_index: 2, changed: true, kind: 'composite', room_type_id: 'yo', rate_plan_id: 'p2', adults: 2,
				old_room_type_id: 'wa', old_rate_plan_id: 'p1', old_adults: 2, old_room_total: 120000, old_coupon_share: 428,
				old_points_share: 1286, new_total: 80000, coupon_share: 333, points_share: 1000, charge: 79667, in_penalty: false
			}
		]);
		expect(r).toEqual({
			index: 2, changed: true, kind: 'composite', roomTypeId: 'yo', planId: 'p2', adults: 2, oldRoomTypeId: 'wa', oldPlanId: 'p1',
			oldAdults: 2, oldTotal: 120000, oldCouponShare: 428, oldPointsShare: 1286, newTotal: 80000, couponShare: 333, pointsShare: 1000,
			charge: 79667, inPenalty: false, lines: [], cancellationPolicy: null
		});
		expect(mapAmendRoomsQuoteRooms([{ room_index: 1, kind: 'dates' }])[0].kind).toBe('none');
	});
	it('mapAmendRoomsQuoteRooms: 部屋の泊明細（quote.lines）と変更後の規定', () => {
		const [r] = mapAmendRoomsQuoteRooms([
			{
				room_index: 2, changed: true, kind: 'plan',
				quote: { lines: [{ date: '2026-11-10', adults: 2, unit_price: 20000, subtotal: 40000 }], total: 40000 },
				cancellation_policy: { rules: [{ days_before: 3, rate: 0.3 }] }
			}
		]);
		expect(r.lines).toEqual([{ date: '2026-11-10', unitPrice: 20000, adults: 2, subtotal: 40000 }]);
		expect(r.cancellationPolicy).toEqual({ rules: [{ days_before: 3, rate: 0.3 }] });
	});
	it('policyRulesOf: 配列・{rules}・専用ページの規定・規定なし（会員グレード）', () => {
		expect(policyRulesOf([{ days_before: 1, rate: 0.5 }, { days_before: 7, rate: 0.2 }])).toEqual({
			source: 'plan',
			rules: [{ days_before: 7, rate: 0.2 }, { days_before: 1, rate: 0.5 }]
		});
		expect(policyRulesOf({ rules: [{ days_before: 3, rate: 0.3 }], member_page: { mode: 'favorable', rules: [] } }).source).toBe('plan');
		expect(policyRulesOf({ rules: [{ days_before: 7, rate: 0.1 }], source: 'member_page' }).source).toBe('member_page');
		expect(policyRulesOf(null)).toEqual({ source: 'rank', rules: [] });
		expect(policyRulesOf({ rules: [] })).toEqual({ source: 'rank', rules: [] });
	});
});

describe('canAmendRoomOf（「このお部屋を変更」を出すか）', () => {
	const base = {
		reserved: true,
		deadlinePassed: false,
		remaining: 1,
		prepaidOnline: false,
		room: { cancelled: false, stayStatus: 'reserved' },
		rooms: [
			{ cancelled: false, stayStatus: 'reserved' },
			{ cancelled: true, stayStatus: 'cancelled' }
		]
	};
	it('予約中・締切前・残りあり・現地払い・生きている部屋がすべて reserved なら出す（取り消した部屋は見ない）', () => {
		expect(canAmendRoomOf(base)).toBe(true);
	});
	it.each([
		['予約中でない', { reserved: false }],
		['締切後', { deadlinePassed: true }],
		['回数が尽きた', { remaining: 0 }],
		['オンライン決済済み', { prepaidOnline: true }],
		['取り消した部屋', { room: { cancelled: true, stayStatus: 'cancelled' } }],
		['別の部屋がチェックイン済み', { rooms: [{ cancelled: false, stayStatus: 'reserved' }, { cancelled: false, stayStatus: 'checked_in' }] }]
	])('%s は出さない', (_, over) => {
		expect(canAmendRoomOf({ ...base, ...over })).toBe(false);
	});
});

describe('parseAdults', () => {
	it('1〜6 の整数だけ', () => {
		expect(['1', '6', 3].map(parseAdults)).toEqual([1, 6, 3]);
		expect(['0', '7', '2.5', 'x', '', null, undefined].map(parseAdults)).toEqual([null, null, null, null, null, null, null]);
	});
});

describe('amendRoomErrorCode（DB の例外の語 → コード）', () => {
	it.each([
		['prepaid_online', 'prepaid_online'],
		['sold_out:a0000000-0000-0000-0000-00000000000b', 'sold_out'],
		['room_not_found', 'room_not_found'],
		['plan_not_found', 'plan_not_found'],
		['not_member_page_booking', 'not_found'],
		['member_page_booking', 'member_page_booking'],
		['amend_in_penalty', 'in_penalty'],
		['payment_incompatible', 'payment_incompatible'],
		['over_capacity', 'over_capacity'],
		['invalid_lines', 'invalid_lines'],
		['not_amendable', 'not_amendable'],
		['min_stay_violation', 'min_stay'],
		['past_checkin', 'past_checkin'],
		['not_authenticated', 'forbidden'],
		['not_found', 'not_found'],
		['invalid_params', 'invalid'],
		['something else', 'error']
	])('%s → %s', (msg, code) => {
		expect(amendRoomErrorCode({ message: msg })).toBe(code);
		expect(amendRoomErrorCode(new Error(msg))).toBe(code);
	});
	it('ステータス', () => {
		expect(amendRoomErrorStatus('sold_out')).toBe(409);
		expect(amendRoomErrorStatus('member_page_booking')).toBe(403);
		expect(amendRoomErrorStatus('not_found')).toBe(404);
		expect(amendRoomErrorStatus('error')).toBe(500);
		expect(amendRoomErrorStatus('in_penalty')).toBe(400);
	});
	it('すべてのコードに日本語の文言がある', () => {
		const codes: AmendRoomErrorCode[] = [
			'prepaid_online', 'past_deadline', 'past_checkin', 'min_stay', 'amend_limit', 'in_penalty', 'no_change', 'sold_out', 'payment_incompatible', 'over_capacity',
			'room_not_found', 'plan_not_found', 'not_sellable', 'invalid_lines', 'member_page_booking', 'not_amendable', 'reason_required',
			'forbidden', 'not_found', 'invalid', 'error'
		];
		for (const c of codes) expect(AMEND_ROOM_MESSAGES_JA[c].length).toBeGreaterThan(0);
	});
});
