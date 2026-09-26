import { describe, expect, it } from 'vitest';
import { calcQuote } from '@autumn-book/core';
import { areaLabel, parseChildren, searchQuery } from './guests';

describe('parseChildren', () => {
	it('未指定・不正値は 0、範囲外は 0〜4 に丸める', () => {
		expect(parseChildren(null)).toBe(0);
		expect(parseChildren('abc')).toBe(0);
		expect(parseChildren('-1')).toBe(0);
		expect(parseChildren('2')).toBe(2);
		expect(parseChildren('9')).toBe(4);
	});
});

describe('searchQuery', () => {
	it('子ども0名は children を付けない（従来 URL と同じ）', () => {
		expect(searchQuery({ checkin: '2026-10-01', nights: 2, adults: 2, children: 0 })).toBe('checkin=2026-10-01&nights=2&adults=2');
		expect(searchQuery({ checkin: '2026-10-01', nights: 2, adults: 2, children: 1 })).toBe(
			'checkin=2026-10-01&nights=2&adults=2&children=1'
		);
	});
});

describe('areaLabel', () => {
	it('住所から「都道府県 市区町村」を取り出す（郡は省く）', () => {
		expect(areaLabel({ prefecture: '岩手県', addressPublic: '岩手県和賀郡西和賀町湯川52-71-10' })).toBe('岩手県 西和賀町');
		expect(areaLabel({ prefecture: '秋田県', addressPublic: '秋田県男鹿市船川港台島字鵜ノ崎62-29' })).toBe('秋田県 男鹿市');
		expect(areaLabel({ prefecture: 'Iwate', addressPublic: '52-71-10 Yugawa, Nishiwaga-cho' })).toBe('Iwate');
	});
});

describe('calcQuote（子ども）', () => {
	const base = { checkin: '2026-10-01', nights: 2, adults: 2, nightlyRate: () => 10000 };
	it('子ども単価が無ければ従来どおり大人のみ（SQL book.quote と同式）', () => {
		const q = calcQuote({ ...base, children: 1 });
		expect(q.total).toBe(40000);
		expect(q.perPerson).toBe(20000);
	});
	it('子ども単価ありは合計に含め、perPerson は大人1名あたりのまま', () => {
		const q = calcQuote({ ...base, children: 1, childNightlyRate: () => 7000 });
		expect(q.total).toBe(54000);
		expect(q.perPerson).toBe(20000);
		expect(q.lines[0]).toMatchObject({ adults: 2, children: 1, childUnitPrice: 7000, subtotal: 27000 });
	});
});
