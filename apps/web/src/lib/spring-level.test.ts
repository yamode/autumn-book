import { describe, expect, it } from 'vitest';
import { DEFAULT_SPRING_BANDS, normalizeSpringBands, springBandFor, springBandLabel, springBandRange } from './spring-level';

describe('全館の湯量の表現', () => {
	it('既定では 0% は「お湯がありません」、1% から「少なめ」', () => {
		expect(springBandFor(0, null).ja).toBe('お湯がありません');
		expect(springBandFor(1, null).ja).toBe('少なめ');
		expect(springBandFor(29, null).ja).toBe('少なめ');
		expect(springBandFor(30, null).ja).toBe('ふつう');
		expect(springBandFor(100, null).ja).toBe('たっぷり');
	});

	it('施設の設定があればそれを使う（並びは問わない）', () => {
		const bands = normalizeSpringBands([
			{ min: 50, ja: '十分', tone: 'blue' },
			{ min: 0, ja: '空', tone: 'gray' }
		]);
		expect(springBandFor(0, bands).ja).toBe('空');
		expect(springBandFor(49, bands).ja).toBe('空');
		expect(springBandFor(50, bands).ja).toBe('十分');
	});

	it('いちばん小さい段階より下はいちばん小さい段階', () => {
		const bands = normalizeSpringBands([{ min: 20, ja: 'あり', tone: 'green' }]);
		expect(springBandFor(5, bands).ja).toBe('あり');
	});

	it('使えない行は捨て、何も残らなければ null（既定を使う）', () => {
		expect(normalizeSpringBands([{ min: 120, ja: 'x' }, { min: 10, ja: '' }])).toBeNull();
		expect(normalizeSpringBands('x')).toBeNull();
		expect(normalizeSpringBands([{ min: 10, ja: 'a', tone: 'bad' }])?.[0].tone).toBe('green');
	});

	it('英語・繁体字が空なら日本語を出す', () => {
		const b = { min: 0, ja: '空', en: '', zh: '', tone: 'gray' as const };
		expect(springBandLabel(b, 'en')).toBe('空');
		expect(springBandLabel(DEFAULT_SPRING_BANDS[3], 'en')).toBe('Plenty');
		expect(springBandLabel(DEFAULT_SPRING_BANDS[3], 'zh-TW')).toBe('充足');
	});

	it('残量に応じて色が変わる（既定は 1〜29% がオレンジ）', () => {
		expect(springBandFor(0, null).tone).toBe('gray');
		expect(springBandFor(15, null).tone).toBe('orange');
		expect(springBandFor(45, null).tone).toBe('green');
		expect(springBandFor(80, null).tone).toBe('blue');
	});

	it('管理画面の範囲表示', () => {
		expect(DEFAULT_SPRING_BANDS.map((_, i) => springBandRange(DEFAULT_SPRING_BANDS, i))).toEqual(['0%', '1〜29%', '30〜59%', '60〜100%']);
	});
});
