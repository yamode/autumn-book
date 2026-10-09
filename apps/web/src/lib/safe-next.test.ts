import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
	it('同じサイト内の相対パスはそのまま通す', () => {
		expect(safeNext('/account', '/x')).toBe('/account');
		expect(safeNext('/plans?f=oga#top', '/x')).toBe('/plans?f=oga#top');
	});
	it('空・未指定は既定値', () => {
		expect(safeNext(null, '/account')).toBe('/account');
		expect(safeNext('', '/account')).toBe('/account');
	});
	it('外部 URL・プロトコル相対・バックスラッシュ・制御文字は既定値', () => {
		for (const bad of [
			'https://evil.example/',
			'//evil.example',
			'/\\evil.example',
			'\\\\evil.example',
			'javascript:alert(1)',
			'/\t/evil.example',
			'account'
		]) {
			expect(safeNext(bad, '/account')).toBe('/account');
		}
	});
});
