import { describe, expect, it } from 'vitest';
import { CANON, skyClock, sunTimes } from './sun';

const at = (iso: string) => new Date(iso);
const hm = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const near = (h: number, target: string, tolMin = 8) => {
	const [a, b] = target.split(':').map(Number);
	expect(Math.abs(h - (a + b / 60)) * 60, `${hm(h)} ≒ ${target}`).toBeLessThanOrEqual(tolMin);
};

describe('日の出・日の入り（秋田・岩手の県境あたり）', () => {
	it('冬至は早く暮れる', () => {
		const s = sunTimes(at('2026-12-22T03:00:00Z'));
		near(s.rise, '6:55');
		near(s.set, '16:20');
	});
	it('夏至は遅くまで明るい', () => {
		const s = sunTimes(at('2026-06-21T03:00:00Z'));
		near(s.rise, '4:15');
		near(s.set, '19:05');
	});
	it('日本時間の日付で計算する（UTC では前日でも）', () => {
		expect(sunTimes(at('2026-12-21T16:00:00Z'))).toEqual(sunTimes(at('2026-12-22T10:00:00Z')));
	});
});

describe('標準の一日への読み替え', () => {
	const s = sunTimes(at('2026-12-22T03:00:00Z'));
	it('日の出・日の入りが標準の時刻に重なる', () => {
		expect(skyClock(s.rise, s)).toBeCloseTo(CANON.rise, 6);
		expect(skyClock(s.set, s)).toBeCloseTo(CANON.set, 6);
		expect(skyClock(s.noon, s)).toBeCloseTo((CANON.rise + CANON.set) / 2, 6);
	});
	it('冬の 17 時はもう夜の側', () => {
		expect(skyClock(17, s)).toBeGreaterThan(CANON.set);
	});
	it('0 時と 24 時は動かさず、時刻の順は崩さない', () => {
		expect(skyClock(0, s)).toBe(0);
		expect(skyClock(24, s)).toBe(24);
		let prev = -1;
		for (let h = 0; h <= 24; h += 0.25) {
			const c = skyClock(h, s);
			expect(c).toBeGreaterThan(prev);
			prev = c;
		}
	});
});
