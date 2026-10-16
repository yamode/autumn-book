import { describe, expect, it } from 'vitest';
import { addReadIds, parseReadIds, unreadNotices } from './inroom-notice-read';

describe('お知らせの既読（端末ごと）', () => {
	it('壊れた値・配列でない値は空として読む', () => {
		expect(parseReadIds(null)).toEqual([]);
		expect(parseReadIds('{bad')).toEqual([]);
		expect(parseReadIds('{"a":1}')).toEqual([]);
		expect(parseReadIds('["a",1,"b"]')).toEqual(['a', 'b']);
	});

	it('既読のお知らせは出さない', () => {
		const notices = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
		expect(unreadNotices(notices, ['b']).map((n) => n.id)).toEqual(['a', 'c']);
		expect(unreadNotices(notices, [])).toHaveLength(3);
	});

	it('既読に足すと重複を除いて後ろへ並べ、上限を超えたら古いものから捨てる', () => {
		expect(addReadIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
		const many = Array.from({ length: 100 }, (_, i) => `n${i}`);
		const next = addReadIds(many, ['new']);
		expect(next).toHaveLength(100);
		expect(next[0]).toBe('n1');
		expect(next.at(-1)).toBe('new');
	});
});
