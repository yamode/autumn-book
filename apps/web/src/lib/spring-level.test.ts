import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SPRING_BANDS,
	SPRING_TONES,
	SPRING_TONE_ICON,
	normalizeSpringBands,
	springBandFor,
	springBandLabel,
	springBandRange,
	springTipFor
} from './spring-level';

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

	it('どの色にも「?」アイコンの色がある', () => {
		for (const t of SPRING_TONES) expect(SPRING_TONE_ICON[t].dot).toMatch(/^bg-/);
	});

	it('「?」の説明: 段階の説明（その言語）→ 日本語 → 共通の説明（日本語のみ）→ null（既定文）', () => {
		const low = normalizeSpringBands([
			{ min: 0, ja: '少なめ', tone: 'orange', tipJa: '差し湯バルブを閉めてください。\r\n節約にご協力ください。', tipEn: 'Please close the valve.' },
			{ min: 50, ja: 'ふつう', tone: 'green' }
		])!;
		const ja = '差し湯バルブを閉めてください。\n節約にご協力ください。';
		expect(low[0].tipJa).toBe(ja);
		expect(springTipFor(low[0], 'ja', '共通')).toBe(ja);
		expect(springTipFor(low[0], 'en', '共通')).toBe('Please close the valve.');
		expect(springTipFor(low[0], 'zh-TW', '共通')).toBe(ja);
		expect(springTipFor(low[1], 'ja', '共通')).toBe('共通');
		expect(springTipFor(low[1], 'en', '共通')).toBeNull();
		expect(springTipFor(low[1], 'ja', '  ')).toBeNull();
	});
});
