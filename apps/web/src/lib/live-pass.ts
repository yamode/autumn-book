// Autumn Live（閲覧専用のライブ画面）の入場券と、デスクトップアプリからの入場の要求の純関数。
// サーバ（lib/server/live-session.ts・routes/live/session/+server.ts・hooks.server.ts）とテスト（live-pass.test.ts）から使う。
// 設計: docs/autumn-live.md §4
//
// 入場券（Cookie ab_live）: `v1.<deviceId>.<kind>.<userId|->.<exp>.<HMAC-SHA256 base64url>`
//   - Book が LIVE_SESSION_SECRET で署名する。有効 1 時間。Path=/live・HttpOnly・Secure・SameSite=Strict
//   - 効くのは /live 配下の GET / HEAD だけ（hooks.server.ts）。管理画面のログインとは別物
// 入場の要求（POST /live/session の本文）: デスクトップアプリのメインプロセスが、端末の Ed25519 の鍵で署名する。

export const LIVE_COOKIE = 'ab_live';
export const LIVE_PASS_SECONDS = 60 * 60;
/** 署名の時刻のずれの許容（秒） */
export const LIVE_CLOCK_SKEW_SECONDS = 5 * 60;

export type LiveDeviceKind = 'staff' | 'display';
export type LivePass = { deviceId: string; kind: LiveDeviceKind; userId: string | null; exp: number };

const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

export function base64url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
	if (!B64URL.test(text)) return null;
	try {
		const norm = text.replace(/-/g, '+').replace(/_/g, '/');
		const bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4));
		const out = new Uint8Array(new ArrayBuffer(bin.length));
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

async function hmacKey(secret: string | undefined): Promise<CryptoKey | null> {
	const s = secret?.trim() ?? '';
	if (s.length < 32) return null;
	return crypto.subtle.importKey('raw', encoder.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** 入場券の秘密鍵が使える長さか（32 文字以上）。足りなければ入場の口は 503 */
export const livePassConfigured = (secret: string | undefined) => (secret?.trim().length ?? 0) >= 32;

export async function signLivePass(pass: LivePass, secret: string | undefined): Promise<string> {
	const key = await hmacKey(secret);
	if (!key) throw new Error('live_pass_not_configured');
	const body = ['v1', pass.deviceId, pass.kind, pass.userId ?? '-', String(pass.exp)].join('.');
	const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
	return `${body}.${base64url(new Uint8Array(mac))}`;
}

export async function verifyLivePass(token: string | undefined | null, secret: string | undefined, nowSec = Math.floor(Date.now() / 1000)): Promise<LivePass | null> {
	if (!token || token.length > 400) return null;
	const m = /^v1\.([0-9a-f-]{36})\.(staff|display)\.([0-9a-f-]{36}|-)\.(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(token);
	if (!m) return null;
	const [, deviceId, kind, user, exp, mac] = m;
	if (!UUID.test(deviceId) || (user !== '-' && !UUID.test(user))) return null;
	if (Number(exp) <= nowSec) return null;
	const key = await hmacKey(secret);
	const sig = fromBase64url(mac);
	if (!key || !sig) return null;
	const ok = await crypto.subtle.verify('HMAC', key, sig, encoder.encode(token.slice(0, -(mac.length + 1))));
	return ok ? { deviceId, kind: kind as LiveDeviceKind, userId: user === '-' ? null : user, exp: Number(exp) } : null;
}

// ── 入場の要求 ─────────────────────────────────────────

/**
 * 本文（JSON）。どれか 1 つの形:
 *   既存の端末   { deviceId, ts, sig }
 *   業務 PC の登録 { publicKey, ts, sig }            ＋ Authorization: Bearer（ログイン中のスタッフ）
 *   表示端末の登録 { publicKey, code, ts, sig }
 * 署名の対象は liveSignedMessage(...)。登録のときも新しい鍵で署名させる（鍵を持っていることの確かめ）。
 */
export type LiveSessionRequest =
	| { mode: 'existing'; deviceId: string; ts: number; sig: Uint8Array<ArrayBuffer> }
	| { mode: 'register_staff'; publicKey: string; ts: number; sig: Uint8Array<ArrayBuffer> }
	| { mode: 'register_display'; publicKey: string; code: string; ts: number; sig: Uint8Array<ArrayBuffer> };

export type LiveSessionParseError = 'bad_body' | 'bad_ts' | 'bad_key' | 'bad_code' | 'bad_sig';

/** 署名する文字列。順番と区切りを変えるときはデスクトップ側（autumn-pms/desktop）も同時に直すこと */
export function liveSignedMessage(input: { deviceId?: string | null; publicKey?: string | null; code?: string | null; ts: number }): string {
	return ['autumn-live-session-v1', input.deviceId ?? '', input.publicKey ?? '', input.code ?? '', String(input.ts)].join('\n');
}

/** 表示端末の登録コード: 8 桁の数字（区切りの空白・ハイフンは無視） */
export function normalizeLiveCode(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const code = raw.replace(/[\s-]/g, '');
	return /^\d{8}$/.test(code) ? code : null;
}

export function parseLiveSessionRequest(body: unknown, nowSec = Math.floor(Date.now() / 1000)): { ok: true; req: LiveSessionRequest } | { ok: false; error: LiveSessionParseError } {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'bad_body' };
	const b = body as Record<string, unknown>;
	const ts = b.ts;
	if (typeof ts !== 'number' || !Number.isInteger(ts) || Math.abs(ts - nowSec) > LIVE_CLOCK_SKEW_SECONDS) return { ok: false, error: 'bad_ts' };
	const sig = typeof b.sig === 'string' ? fromBase64url(b.sig) : null;
	if (!sig || sig.length !== 64) return { ok: false, error: 'bad_sig' };
	if (typeof b.deviceId === 'string') {
		if (!UUID.test(b.deviceId) || b.publicKey !== undefined || b.code !== undefined) return { ok: false, error: 'bad_body' };
		return { ok: true, req: { mode: 'existing', deviceId: b.deviceId, ts, sig } };
	}
	if (typeof b.publicKey !== 'string') return { ok: false, error: 'bad_body' };
	const raw = fromBase64url(b.publicKey);
	if (!raw || raw.length !== 32) return { ok: false, error: 'bad_key' };
	if (b.code === undefined) return { ok: true, req: { mode: 'register_staff', publicKey: b.publicKey, ts, sig } };
	const code = normalizeLiveCode(b.code);
	if (!code) return { ok: false, error: 'bad_code' };
	return { ok: true, req: { mode: 'register_display', publicKey: b.publicKey, code, ts, sig } };
}

/** 要求の署名を公開鍵（base64url・生の 32 バイト）で確かめる */
export async function verifyLiveSignature(publicKey: string, req: LiveSessionRequest): Promise<boolean> {
	const raw = fromBase64url(publicKey);
	if (!raw || raw.length !== 32) return false;
	try {
		const key = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
		const message = liveSignedMessage({
			deviceId: req.mode === 'existing' ? req.deviceId : null,
			publicKey: req.mode === 'existing' ? null : req.publicKey,
			code: req.mode === 'register_display' ? req.code : null,
			ts: req.ts
		});
		return await crypto.subtle.verify({ name: 'Ed25519' }, key, req.sig, encoder.encode(message));
	} catch {
		return false;
	}
}

/** 登録コードのハッシュ（DB にはこれだけを置く） */
export async function hashLiveCode(code: string): Promise<string> {
	const d = await crypto.subtle.digest('SHA-256', encoder.encode(`autumn-live-code:${code}`));
	return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** /live 配下か（/live・/live/...）。/lively のような別のパスは含めない */
export const isLivePath = (pathname: string) => pathname === '/live' || pathname.startsWith('/live/');
export const LIVE_SESSION_PATH = '/live/session';
