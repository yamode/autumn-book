import { describe, expect, it } from 'vitest';
import { adminRoleOf, isBanned, jwtSessionId } from './admin-passkey';

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: unknown) => `${b64url({ alg: 'ES256' })}.${b64url(payload)}.sig`;

describe('jwtSessionId', () => {
	it('session_id（UUID）を取り出す', () => {
		expect(jwtSessionId(jwt({ sub: 'u', session_id: '0F8FAD5B-D9CB-469F-A165-70867728950E' }))).toBe('0f8fad5b-d9cb-469f-a165-70867728950e');
	});
	it('無い・形が違う・壊れたトークンは null', () => {
		expect(jwtSessionId(jwt({ sub: 'u' }))).toBeNull();
		expect(jwtSessionId(jwt({ session_id: 'not-a-uuid' }))).toBeNull();
		expect(jwtSessionId('abc')).toBeNull();
		expect(jwtSessionId('a.@@@.c')).toBeNull();
		expect(jwtSessionId(null)).toBeNull();
	});
});

describe('adminRoleOf', () => {
	it('admin / staff だけ', () => {
		expect(adminRoleOf({ role: 'admin' })).toBe('admin');
		expect(adminRoleOf({ role: 'staff' })).toBe('staff');
		expect(adminRoleOf({ role: 'member' })).toBeNull();
		expect(adminRoleOf(null)).toBeNull();
	});
});

describe('isBanned', () => {
	it('banned_until が今より後なら停止中', () => {
		const now = Date.parse('2026-10-17T00:00:00Z');
		expect(isBanned('2026-10-18T00:00:00Z', now)).toBe(true);
		expect(isBanned('2026-10-16T00:00:00Z', now)).toBe(false);
		expect(isBanned(null, now)).toBe(false);
		expect(isBanned('none', now)).toBe(false);
	});
});
