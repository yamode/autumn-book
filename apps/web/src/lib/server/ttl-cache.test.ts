import { describe, expect, it } from 'vitest';
import { TtlCache } from './ttl-cache';

describe('TtlCache（短い時間だけ覚える）', () => {
	it('期限までは覚え、過ぎたら忘れる', () => {
		const c = new TtlCache<number>(1000);
		c.set('a', 1, 0);
		expect(c.get('a', 999)).toBe(1);
		expect(c.get('a', 1000)).toBeUndefined();
	});
	it('null も覚える（「無い」を覚えて問い合わせを減らす）', () => {
		const c = new TtlCache<number | null>(1000);
		c.set('a', null, 0);
		expect(c.get('a', 10)).toBeNull();
	});
	it('上限を超えたら古いものから捨てる・消せる', () => {
		const c = new TtlCache<number>(1000, 2);
		c.set('a', 1, 0);
		c.set('b', 2, 0);
		c.set('c', 3, 0);
		expect(c.get('a', 1)).toBeUndefined();
		expect(c.get('c', 1)).toBe(3);
		c.delete('c');
		expect(c.get('c', 1)).toBeUndefined();
		c.clear();
		expect(c.get('b', 1)).toBeUndefined();
	});
});
