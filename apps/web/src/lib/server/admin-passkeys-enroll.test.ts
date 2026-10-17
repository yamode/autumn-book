import { describe, expect, it } from 'vitest';
import { parseEnrollToken } from './admin-passkeys';

// スマホ用の登録 QR の中身（<行id>.<秘密>・2026-10-17）
describe('スマホ用の登録 QR の中身', () => {
	const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
	const secret = 'A'.repeat(43);
	it('行 id と秘密に分ける', () => {
		expect(parseEnrollToken(`${id}.${secret}`)).toEqual({ id, secret });
	});
	it('形が違えば null（空・秘密が短い・余計な文字）', () => {
		expect(parseEnrollToken('')).toBeNull();
		expect(parseEnrollToken(null)).toBeNull();
		expect(parseEnrollToken(`${id}.short`)).toBeNull();
		expect(parseEnrollToken(`${id}.${secret}/x`)).toBeNull();
		expect(parseEnrollToken(`not-a-uuid.${secret}`)).toBeNull();
	});
});
