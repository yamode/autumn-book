import { describe, expect, it } from 'vitest';
import { crossTypeCombos, type ComboOffer } from './partner-room-combos';

const offer = (roomCode: string, remaining: number | null, perPerson: number, plan = 'P1'): ComboOffer => ({
	roomCode,
	roomName: roomCode === 'wa' ? '和室' : '洋室',
	planCode: plan,
	planName: plan,
	mealType: '2食',
	perPerson,
	totalPerPerson: perPerson * 2,
	remaining
});

describe('crossTypeCombos', () => {
	it('1 室なら組み合わせは作らない', () => {
		expect(crossTypeCombos([offer('wa', 1, 10000)], 1, 2)).toEqual([]);
	});
	it('単独で足りる部屋タイプがあれば組み合わせは出さない', () => {
		expect(crossTypeCombos([offer('wa', 2, 10000), offer('yo', 1, 9000)], 2, 2)).toEqual([]);
	});
	it('残室を見せない（null）なら単独で足りる扱い', () => {
		expect(crossTypeCombos([offer('wa', null, 10000), offer('yo', 1, 9000)], 3, 2)).toEqual([]);
	});
	it('単独では足りないとき、安い方から残室いっぱいまで取る', () => {
		const r = crossTypeCombos([offer('wa', 1, 10000), offer('yo', 2, 9000)], 3, 2);
		expect(r).toHaveLength(1);
		expect(r[0].parts.map((p) => [p.roomCode, p.rooms])).toEqual([['yo', 2], ['wa', 1]]);
		// 洋室 2 室 × 18,000 × 2 名 + 和室 1 室 × 20,000 × 2 名
		expect(r[0].total).toBe(18000 * 2 * 2 + 20000 * 2);
	});
	it('残室の合計が足りなければ出さない', () => {
		expect(crossTypeCombos([offer('wa', 1, 10000), offer('yo', 1, 9000)], 3, 2)).toEqual([]);
	});
	it('プランごとに別の組み合わせ・安い順', () => {
		const r = crossTypeCombos([offer('wa', 1, 10000, 'A'), offer('yo', 1, 9000, 'A'), offer('wa', 1, 5000, 'B'), offer('yo', 1, 4000, 'B')], 2, 1);
		expect(r.map((c) => c.planCode)).toEqual(['B', 'A']);
	});
});
