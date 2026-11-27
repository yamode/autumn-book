// 管理画面「Autumn Live の端末」の登録コード（docs/autumn-live.md §4.3）
import { describe, expect, it } from 'vitest';
import { newLiveCode } from './live-devices';
import { normalizeLiveCode } from '$lib/live-pass';

describe('登録コード', () => {
	it('いつも 8 桁の数字で、端末側の入力の形（normalizeLiveCode）に通る', () => {
		for (let i = 0; i < 500; i++) {
			const c = newLiveCode();
			expect(c).toMatch(/^\d{8}$/);
			expect(normalizeLiveCode(c)).toBe(c);
		}
	});

	it('毎回ちがう', () => {
		const seen = new Set(Array.from({ length: 200 }, () => newLiveCode()));
		expect(seen.size).toBeGreaterThan(195);
	});
});
