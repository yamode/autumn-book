import { describe, expect, it } from 'vitest';
import { rateLimitClientKey } from './client-key';

describe('回数制限の接続元キー（H-2）', () => {
	it('IPv4 はそのまま', () => {
		expect(rateLimitClientKey('203.0.113.5')).toBe('203.0.113.5');
		expect(rateLimitClientKey(' 10.0.0.1 ')).toBe('10.0.0.1');
	});

	it('IPv6 は /64 に丸める（同じ /64 なら同じキー）', () => {
		const a = rateLimitClientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
		const b = rateLimitClientKey('2001:0DB8:0001:0002::1');
		expect(a).toBe('2001:0db8:0001:0002::/64');
		expect(b).toBe(a);
		expect(rateLimitClientKey('2001:db8:1:3::1')).not.toBe(a);
	});

	it('省略形・ゾーン付きも読める', () => {
		expect(rateLimitClientKey('::1')).toBe('0000:0000:0000:0000::/64');
		expect(rateLimitClientKey('fe80::1%eth0')).toBe('fe80:0000:0000:0000::/64');
		expect(rateLimitClientKey('2001:db8::')).toBe('2001:0db8:0000:0000::/64');
	});

	it('IPv4 射影アドレスは IPv4 に戻す', () => {
		expect(rateLimitClientKey('::ffff:192.0.2.1')).toBe('192.0.2.1');
		expect(rateLimitClientKey('::ffff:c000:201')).toBe('192.0.2.1');
	});

	it('読めない値はそのまま・空は空', () => {
		expect(rateLimitClientKey('not:an::ip::x')).toBe('not:an::ip::x');
		expect(rateLimitClientKey('')).toBe('');
		expect(rateLimitClientKey(null)).toBe('');
	});
});
