import { describe, expect, it } from 'vitest';
import { legacyKind, legacyNights, splitLegacyStays, type LegacyStay } from './legacy-stays';

const s = (code: string, checkin: string, checkout: string, status: LegacyStay['status']): LegacyStay => ({
	code, facilityUuid: 'f', roomTypeName: '', checkin, checkout, roomCount: 1, adults: 2, children: 0, status, kind: 'legacy'
});

describe('legacyNights', () => {
	it('日付の差を泊数にする', () => {
		expect(legacyNights({ checkin: '2026-12-30', checkout: '2027-01-02' })).toBe(3);
	});
	it('壊れた日付・逆転は 0', () => {
		expect(legacyNights({ checkin: '2027-01-02', checkout: '2027-01-02' })).toBe(0);
		expect(legacyNights({ checkin: 'x', checkout: '2027-01-02' })).toBe(0);
	});
});

describe('splitLegacyStays', () => {
	const list = [
		s('A', '2027-03-01', '2027-03-02', 'reserved'),
		s('B', '2026-12-01', '2026-12-03', 'reserved'),
		s('C', '2025-05-01', '2025-05-02', 'stayed'),
		s('D', '2026-11-20', '2026-11-22', 'reserved'), // 滞在中（チェックアウトが今日以降）
		s('E', '2026-10-01', '2026-10-02', 'reserved'), // PMS で宿泊済みに変わっていない古い予約
		s('F', '2026-08-01', '2026-08-02', 'stayed')
	];
	const { upcoming, past } = splitLegacyStays(list, '2026-11-21');
	it('これからの予約は近い順', () => {
		expect(upcoming.map((x) => x.code)).toEqual(['D', 'B', 'A']);
	});
	it('過去の利用は新しい順（チェックアウト済みの予約中も過去へ）', () => {
		expect(past.map((x) => x.code)).toEqual(['E', 'F', 'C']);
	});
});

describe('legacyKind', () => {
	it('tripla・予約番は旧会員制度、それ以外は電話・直接', () => {
		expect(['tripla', 'yoyakuban', 'direct', 'phone'].map(legacyKind)).toEqual(['legacy', 'legacy', 'direct', 'direct']);
	});
});
