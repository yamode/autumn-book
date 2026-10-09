import { describe, expect, it } from 'vitest';
import { applySecurityHeaders } from './security-headers';

describe('applySecurityHeaders', () => {
	it('基本のヘッダを付け、本番ドメインだけ HSTS を付ける', () => {
		const prod = applySecurityHeaders(new Response('x'), new URL('https://book.yamado.app/plans'));
		expect(prod.headers.get('x-frame-options')).toBe('SAMEORIGIN');
		expect(prod.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
		expect(prod.headers.get('x-content-type-options')).toBe('nosniff');
		expect(prod.headers.get('strict-transport-security')).toContain('max-age=');
		const preview = applySecurityHeaders(new Response('x'), new URL('https://abc.autumn-book.pages.dev/'));
		expect(preview.headers.get('strict-transport-security')).toBeNull();
	});
	it('既にあるヘッダは上書きしない', () => {
		const res = new Response('x', { headers: { 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'" } });
		const out = applySecurityHeaders(res, new URL('https://book.yamado.app/p/t'));
		expect(out.headers.get('referrer-policy')).toBe('no-referrer');
		expect(out.headers.get('content-security-policy')).toBe("default-src 'none'");
	});
	it('ヘッダが変更不可の応答でも付けられる', () => {
		const res = Response.redirect('https://book.yamado.app/', 302);
		const out = applySecurityHeaders(res, new URL('https://book.yamado.app/'));
		expect(out.headers.get('x-frame-options')).toBe('SAMEORIGIN');
		expect(out.status).toBe(302);
	});
});
