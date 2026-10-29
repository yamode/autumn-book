import { describe, expect, it } from 'vitest';
import { hpCorsHeaders, isHpOrigin } from './hp-cors';

describe('hpCorsHeaders', () => {
	it('両 HP のオリジンだけ許可する', () => {
		for (const o of ['https://www.yamado.co.jp', 'https://yamado.co.jp', 'https://oga.yamado.co.jp']) {
			expect(hpCorsHeaders(o)['Access-Control-Allow-Origin']).toBe(o);
		}
	});
	it('それ以外・オリジン無しには許可ヘッダを付けない', () => {
		for (const o of ['https://evil.example', 'http://www.yamado.co.jp', 'https://www.yamado.co.jp.evil.example', null]) {
			expect(hpCorsHeaders(o)['Access-Control-Allow-Origin']).toBeUndefined();
			expect(isHpOrigin(o)).toBe(false);
		}
		expect(hpCorsHeaders(null).Vary).toBe('Origin');
	});
});
