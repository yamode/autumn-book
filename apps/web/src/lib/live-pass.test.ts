// Autumn Live の入場券と入場の要求（docs/autumn-live.md §4）
import { describe, expect, it } from 'vitest';
import {
	base64url,
	hashLiveCode,
	isLivePath,
	liveSignedMessage,
	normalizeLiveCode,
	parseLiveSessionRequest,
	signLivePass,
	verifyLivePass,
	verifyLiveSignature,
	type LivePass
} from './live-pass';

const SECRET = 'x'.repeat(40);
const DEVICE = '6f1c2b8e-3d4a-4b5c-8d9e-0a1b2c3d4e5f';
const USER = '11111111-2222-4333-8444-555555555555';
const NOW = 1_800_000_000;

async function keyPair() {
	const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
	const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
	return { kp, publicKey: base64url(raw) };
}
async function sign(kp: CryptoKeyPair, message: string) {
	return base64url(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(message))));
}

describe('入場券（ab_live）', () => {
	const pass: LivePass = { deviceId: DEVICE, kind: 'staff', userId: USER, exp: NOW + 3600 };

	it('署名した入場券は同じ鍵で読める', async () => {
		const token = await signLivePass(pass, SECRET);
		expect(await verifyLivePass(token, SECRET, NOW)).toEqual(pass);
	});

	it('表示端末（人なし）も読める', async () => {
		const p = { ...pass, kind: 'display' as const, userId: null };
		expect(await verifyLivePass(await signLivePass(p, SECRET), SECRET, NOW)).toEqual(p);
	});

	it('期限切れ・別の鍵・書き換え・短すぎる鍵は通さない', async () => {
		const token = await signLivePass(pass, SECRET);
		expect(await verifyLivePass(token, SECRET, NOW + 3600)).toBeNull();
		expect(await verifyLivePass(token, 'y'.repeat(40), NOW)).toBeNull();
		expect(await verifyLivePass(token.replace('.staff.', '.display.'), SECRET, NOW)).toBeNull();
		expect(await verifyLivePass(token, 'short', NOW)).toBeNull();
		expect(await verifyLivePass(undefined, SECRET, NOW)).toBeNull();
		await expect(signLivePass(pass, 'short')).rejects.toThrow();
	});
});

describe('入場の要求の形', () => {
	const sig = base64url(new Uint8Array(64));
	const pk = base64url(new Uint8Array(32).fill(7));

	it('既存の端末・業務 PC の登録・表示端末の登録を見分ける', () => {
		expect(parseLiveSessionRequest({ deviceId: DEVICE, ts: NOW, sig }, NOW)).toMatchObject({ ok: true, req: { mode: 'existing', deviceId: DEVICE } });
		expect(parseLiveSessionRequest({ publicKey: pk, ts: NOW, sig }, NOW)).toMatchObject({ ok: true, req: { mode: 'register_staff' } });
		expect(parseLiveSessionRequest({ publicKey: pk, code: '1234 5678', ts: NOW, sig }, NOW)).toMatchObject({ ok: true, req: { mode: 'register_display', code: '12345678' } });
	});

	it('時刻のずれが 5 分を超える・形が違うものは断る', () => {
		expect(parseLiveSessionRequest({ deviceId: DEVICE, ts: NOW - 301, sig }, NOW)).toEqual({ ok: false, error: 'bad_ts' });
		expect(parseLiveSessionRequest({ deviceId: DEVICE, ts: NOW, sig: 'abc' }, NOW)).toEqual({ ok: false, error: 'bad_sig' });
		expect(parseLiveSessionRequest({ deviceId: 'nope', ts: NOW, sig }, NOW)).toEqual({ ok: false, error: 'bad_body' });
		expect(parseLiveSessionRequest({ deviceId: DEVICE, publicKey: pk, ts: NOW, sig }, NOW)).toEqual({ ok: false, error: 'bad_body' });
		expect(parseLiveSessionRequest({ publicKey: 'AAAA', ts: NOW, sig }, NOW)).toEqual({ ok: false, error: 'bad_key' });
		expect(parseLiveSessionRequest({ publicKey: pk, code: '123', ts: NOW, sig }, NOW)).toEqual({ ok: false, error: 'bad_code' });
		expect(parseLiveSessionRequest(null, NOW)).toEqual({ ok: false, error: 'bad_body' });
	});
});

describe('端末の署名', () => {
	it('端末の鍵で署名した要求だけが通る', async () => {
		const { kp, publicKey } = await keyPair();
		const ts = Math.floor(Date.now() / 1000);
		const good = await sign(kp, liveSignedMessage({ deviceId: DEVICE, ts }));
		const parsed = parseLiveSessionRequest({ deviceId: DEVICE, ts, sig: good });
		if (!parsed.ok) throw new Error('parse');
		expect(await verifyLiveSignature(publicKey, parsed.req)).toBe(true);

		const other = await keyPair();
		expect(await verifyLiveSignature(other.publicKey, parsed.req)).toBe(false);
		const tampered = parseLiveSessionRequest({ deviceId: DEVICE, ts: ts + 1, sig: good });
		if (!tampered.ok) throw new Error('parse');
		expect(await verifyLiveSignature(publicKey, tampered.req)).toBe(false);
	});

	it('登録では新しい鍵そのものとコードまで署名に含める', async () => {
		const { kp, publicKey } = await keyPair();
		const ts = Math.floor(Date.now() / 1000);
		const sig = await sign(kp, liveSignedMessage({ publicKey, code: '12345678', ts }));
		const ok = parseLiveSessionRequest({ publicKey, code: '1234-5678', ts, sig });
		if (!ok.ok) throw new Error('parse');
		expect(await verifyLiveSignature(publicKey, ok.req)).toBe(true);
		const otherCode = parseLiveSessionRequest({ publicKey, code: '87654321', ts, sig });
		if (!otherCode.ok) throw new Error('parse');
		expect(await verifyLiveSignature(publicKey, otherCode.req)).toBe(false);
	});
});

describe('そのほか', () => {
	it('登録コードは 8 桁の数字だけ', () => {
		expect(normalizeLiveCode('1234-5678')).toBe('12345678');
		expect(normalizeLiveCode('1234567')).toBeNull();
		expect(normalizeLiveCode('abcdefgh')).toBeNull();
		expect(normalizeLiveCode(12345678)).toBeNull();
	});

	it('コードのハッシュは決まった値で、コードそのものを含まない', async () => {
		const h = await hashLiveCode('12345678');
		expect(h).toMatch(/^[0-9a-f]{64}$/);
		expect(h).toBe(await hashLiveCode('12345678'));
		expect(h).not.toBe(await hashLiveCode('12345679'));
	});

	it('/live 配下の判定', () => {
		expect(isLivePath('/live')).toBe(true);
		expect(isLivePath('/live/api/snapshot')).toBe(true);
		expect(isLivePath('/lively')).toBe(false);
		expect(isLivePath('/admin/live')).toBe(false);
	});
});
