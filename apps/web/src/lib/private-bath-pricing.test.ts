import { describe, expect, it } from 'vitest';
import {
	buildBathPricing,
	normalizeBathPricing,
	parseBathPrice,
	DEFAULT_FREE_CHANNELS,
	DEFAULT_FREE_FM_CODES
} from './private-bath-pricing';

describe('normalizeBathPricing', () => {
	it('未設定は無料・PMS と同じ既定の無料経路', () => {
		expect(normalizeBathPricing(null)).toEqual({
			price: 0,
			freeChannels: DEFAULT_FREE_CHANNELS,
			freeFmCodes: DEFAULT_FREE_FM_CODES
		});
	});
	it('男鹿の本番の形（料金だけ保存）を読める', () => {
		const p = normalizeBathPricing({ price: 2200, enabled: true, cutoffMin: 30 });
		expect(p.price).toBe(2200);
		expect(p.freeChannels).toContain('tripla');
	});
	it('負の値・桁違いは丸める', () => {
		expect(normalizeBathPricing({ price: -5 }).price).toBe(0);
		expect(normalizeBathPricing({ price: 99_999_999 }).price).toBe(1_000_000);
	});
});

describe('buildBathPricing', () => {
	const prev = normalizeBathPricing({ price: 2200 });

	it('選んだ経路の FileMaker コードも一緒に保存する', () => {
		const p = buildBathPricing(2200, ['direct', 'ikkyu'], prev);
		expect(p.freeChannels).toEqual(['direct', 'ikkyu']);
		expect(p.freeFmCodes.sort()).toEqual(['00', '80']);
	});
	it('直販を外したら FM の 00 も外れる（FM 由来の直販だけ無料、を起こさない）', () => {
		const p = buildBathPricing(2200, ['tripla'], prev);
		expect(p.freeFmCodes).toEqual(['52']);
	});
	it('一覧に無いコードは消さずに残す', () => {
		const odd = normalizeBathPricing({ price: 2200, freeChannels: ['direct', 'x-legacy'], freeFmCodes: ['00', '99'] });
		const p = buildBathPricing(2200, [], odd);
		expect(p.freeChannels).toEqual(['x-legacy']);
		expect(p.freeFmCodes).toEqual(['99']);
	});
	it('知らない経路コードの送信は無視する', () => {
		expect(buildBathPricing(0, ['evil'], prev).freeChannels).toEqual([]);
	});
});

describe('parseBathPrice', () => {
	it('カンマ・円記号つきも読む', () => {
		expect(parseBathPrice('2,200')).toBe(2200);
		expect(parseBathPrice('¥2200円')).toBe(2200);
	});
	it('数字でない・上限超えは null', () => {
		expect(parseBathPrice('abc')).toBeNull();
		expect(parseBathPrice('')).toBeNull();
		expect(parseBathPrice('2000000')).toBeNull();
	});
});
