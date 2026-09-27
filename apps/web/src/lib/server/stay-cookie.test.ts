import { describe, expect, it } from 'vitest';
import { stayCookieMaxAge } from './stay-cookie';

describe('stayCookieMaxAge', () => {
	it('keeps a bookmarked stay available beyond three nights', () => {
		const now = Date.parse('2026-09-27T10:00:00+09:00');
		expect(stayCookieMaxAge('2026-10-02T11:00:00+09:00', now)).toBe(8 * 86400 + 3600);
	});

	it('keeps the expired-state message for short stays', () => {
		const now = Date.parse('2026-09-27T10:00:00+09:00');
		expect(stayCookieMaxAge('2026-09-28T11:00:00+09:00', now)).toBe(4 * 86400 + 3600);
	});
});
