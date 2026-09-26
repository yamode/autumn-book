import { describe, expect, it } from 'vitest';
import { areaLabel, searchQuery } from './guests';

describe('searchQuery', () => {
	it('大人のみの検索条件をクエリ文字列にする', () => {
		expect(searchQuery({ checkin: '2026-10-01', nights: 2, adults: 2 })).toBe('checkin=2026-10-01&nights=2&adults=2');
	});
});

describe('areaLabel', () => {
	it('住所から「都道府県 市区町村」を取り出す（郡は省く）', () => {
		expect(areaLabel({ prefecture: '岩手県', addressPublic: '岩手県和賀郡西和賀町湯川52-71-10' })).toBe('岩手県 西和賀町');
		expect(areaLabel({ prefecture: '秋田県', addressPublic: '秋田県男鹿市船川港台島字鵜ノ崎62-29' })).toBe('秋田県 男鹿市');
		expect(areaLabel({ prefecture: 'Iwate', addressPublic: '52-71-10 Yugawa, Nishiwaga-cho' })).toBe('Iwate');
	});
});
