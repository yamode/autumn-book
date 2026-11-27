import { describe, expect, it } from 'vitest';
import { inviteUrl, normalizeInviteCode, parseShareRates, shareRatesText } from './ambassador';

describe('normalizeInviteCode', () => {
	it('空白・ハイフン・小文字を揃える', () => {
		expect(normalizeInviteCode(' k7q3-mx9p ')).toBe('K7Q3MX9P');
	});
	it('見間違えやすい字や長さ違いは受け付けない', () => {
		expect(normalizeInviteCode('K7Q3MX9O')).toBeNull(); // O
		expect(normalizeInviteCode('K7Q3MX91')).toBeNull(); // 1
		expect(normalizeInviteCode('K7Q3MX9')).toBeNull();
		expect(normalizeInviteCode(null)).toBeNull();
	});
});

describe('parseShareRates', () => {
	it('カンマ・読点・% を受け付け、末尾の 0 を落とす', () => {
		expect(parseShareRates('2, 1、0.5%, 0')).toEqual([2, 1, 0.5]);
		expect(parseShareRates('')).toEqual([]);
	});
	it('範囲外・11年分以上は null', () => {
		expect(parseShareRates('21')).toBeNull();
		expect(parseShareRates('-1')).toBeNull();
		expect(parseShareRates('1,1,1,1,1,1,1,1,1,1,1')).toBeNull();
		expect(parseShareRates('abc')).toBeNull();
	});
});

describe('表示', () => {
	it('割合の説明', () => {
		expect(shareRatesText([2, 1, 0.5])).toBe('1年目 2%・2年目 1%・3年目 0.5%・4年目以降 0%');
	});
	it('招待 URL', () => {
		expect(inviteUrl('https://example.test/', 'K7Q3MX9P')).toBe('https://example.test/invite/K7Q3MX9P');
	});
});
