// Autumn Live の画面の数字の読み替え（docs/autumn-live.md §7）
import { describe, expect, it } from 'vitest';
import { cumulativeUntil, diffGrains, pctChange, rate28, usualFraction, yenShort } from './model';

describe('累計といつもの割合', () => {
	const by30 = Array.from({ length: 48 }, (_, i) => (i < 24 ? 0 : 10));
	it('h 時までの累計（30 分の途中は按分）', () => {
		expect(cumulativeUntil(by30, 12)).toBe(0);
		expect(cumulativeUntil(by30, 13)).toBe(20);
		expect(cumulativeUntil(by30, 12.25)).toBe(5);
		expect(cumulativeUntil(by30, 24)).toBe(240);
	});
	it('いつもの割合', () => {
		expect(usualFraction(by30, 18)).toBe(0.5);
		expect(usualFraction(null, 18)).toBeNull();
		expect(usualFraction(new Array(48).fill(0), 18)).toBeNull();
	});
});

describe('率と表示', () => {
	it('前の段が 50 人未満なら 28 日の率は出さない', () => {
		expect(rate28(10, 49)).toBeNull();
		expect(rate28(10, 50)).toBe(0.2);
		expect(rate28(undefined, 100)).toBeNull();
	});
	it('金額と割合', () => {
		expect(yenShort(184_200_000)).toBe('1.84億円');
		expect(yenShort(12_400_000)).toBe('1,240万円');
		expect(yenShort(38_400)).toBe('4万円');
		expect(yenShort(9_800)).toBe('9,800円');
		expect(pctChange(110, 100)).toBe(10);
		expect(pctChange(1, 0)).toBeNull();
	});
});

describe('粒の差分', () => {
	it('来た・動いた・離れた', () => {
		const prev = new Map([
			['a', { s: 1, f: null }],
			['b', { s: 3, f: 'oga' }],
			['c', { s: 5, f: 'nishiwaga' }]
		]);
		const r = diffGrains(prev, [
			{ k: 'a', s: 2, f: null, src: 'direct' },
			{ k: 'b', s: 3, f: 'oga', src: 'search' },
			{ k: 'd', s: 1, f: null, src: 'sns' }
		]);
		expect(r.added.map((g) => g.k)).toEqual(['d']);
		expect(r.moved).toEqual([{ k: 'a', from: 1, to: 2, f: null }]);
		expect(r.left).toEqual([{ k: 'c', s: 5 }]);
	});
});
