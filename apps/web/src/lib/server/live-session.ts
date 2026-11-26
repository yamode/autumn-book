// Autumn Live の入場の口（POST /live/session）と、入場券の読み取り。設計: docs/autumn-live.md §4
//
// ★呼ぶのはデスクトップアプリ（autumn-pms/desktop）のメインプロセスだけ。ブラウザから開く道は残さない（§0）:
//   - Origin / Referer 付き（ページの fetch・フォーム）は 403。x-autumn-desktop が無いものも 403
//   - 端末の Ed25519 の鍵での署名を確かめる。業務 PC は加えて、ログイン中のスタッフの access_token（Bearer）を確かめる
// ★発行するのは Live 用の入場券（Cookie ab_live・/live の GET だけに効く）。Supabase のログインセッションは作らない
// ★service_role を使う（admin-client.ts の例外その16）。端末の表 book.live_devices は service_role だけに grant している
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { AUTH_MODE } from '$lib/server/auth';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { clientIp, ipKey, RATE_RULES, rateCheck, rateHit, rateReset } from '$lib/server/login-rate-limit';
import { logAccessEvent } from '$lib/server/access-log';
import { desktopSsoUserProblem } from '$lib/admin-desktop-sso';
import {
	LIVE_COOKIE,
	LIVE_PASS_SECONDS,
	hashLiveCode,
	livePassConfigured,
	parseLiveSessionRequest,
	signLivePass,
	verifyLivePass,
	verifyLiveSignature,
	type LiveDeviceKind,
	type LivePass,
	type LiveSessionRequest
} from '$lib/live-pass';

const secret = () => env.LIVE_SESSION_SECRET;
const BODY_MAX = 4096;
const LABEL_MAX = 120;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const HEADERS = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' };

/**
 * 失敗の理由。デスクトップアプリはこれで次の手を決める:
 *   login_required … 業務 PC でスタッフのログインが無い・切れた（メイン画面でログインしてから開き直す）
 *   revoked        … 端末が止められている（業務 PC は新しい鍵で登録し直す・表示端末は登録コードを入力し直す）
 *   unknown_device … 端末が登録されていない（同上）
 *   bad_code       … 登録コードが違う・切れた・使用済み
 *   rejected       … それ以外（形・署名・時刻・回数制限など。細かい理由は返さない）
 */
export type LiveSessionError = 'login_required' | 'revoked' | 'unknown_device' | 'bad_code' | 'rejected' | 'unavailable';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: HEADERS });

/** hooks から: /live 配下で、届いた入場券を確かめる。無い・壊れている・期限切れなら null */
export function readLivePass(event: RequestEvent): Promise<LivePass | null> {
	return verifyLivePass(event.cookies.get(LIVE_COOKIE), secret());
}

type DeviceRow = { id: string; kind: LiveDeviceKind; public_key: string; revoked_at: string | null };
const book = (svc: SupabaseClient) => svc.schema('book');

function bearerOf(headers: Headers): string | null {
	const m = /^Bearer\s+(\S+)$/.exec((headers.get('authorization') ?? '').trim());
	return m && m[1].length <= 8192 && JWT_SHAPE.test(m[1]) ? m[1] : null;
}

/** Bearer の access_token を認証サーバで確かめ、admin / staff・停止なしならその人。無い・だめなら null */
async function staffFromBearer(svc: SupabaseClient, headers: Headers): Promise<{ id: string; email: string | null } | null> {
	const token = bearerOf(headers);
	if (!token) return null;
	const { data, error } = await svc.auth.getUser(token);
	const user = error ? null : data?.user ?? null;
	if (!user || desktopSsoUserProblem(user as Parameters<typeof desktopSsoUserProblem>[0])) return null;
	return { id: user.id, email: user.email ?? null };
}

export async function handleLiveSession(event: RequestEvent): Promise<Response> {
	// デモ認証の環境では無い扱い（デスクトップは 404 を「未配備」とみなす）
	if (AUTH_MODE !== 'supabase') return json(404, { error: 'unavailable' satisfies LiveSessionError });

	const headers = event.request.headers;
	const label = (headers.get('x-autumn-desktop') ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, LABEL_MAX);
	const ip = clientIp(event.request);
	const key = ipKey(ip);
	let mode: LiveSessionRequest['mode'] | null = null;

	const fail = async (reason: string, status: number, error: LiveSessionError, opts: { count?: boolean; user?: { id: string; email?: string | null } } = {}) => {
		logAccessEvent(event, {
			event: 'login_failure',
			user: opts.user ?? null,
			status,
			detail: { reason: `live_session_${reason}`, method: 'live_session', mode, device: label || null }
		});
		if (opts.count !== false) await rateHit(event.platform, RATE_RULES.liveIp, key);
		return json(status, { error });
	};

	// ページ（ブラウザ）からの要求は断る。デスクトップのメインプロセスの fetch は Origin / Referer を付けない
	if (headers.get('origin') || headers.get('referer')) return fail('has_origin', 403, 'rejected');
	if (!label) return fail('no_desktop_header', 403, 'rejected');
	if (!livePassConfigured(secret())) return fail('not_configured', 503, 'unavailable', { count: false });
	if ((await rateCheck(event.platform, RATE_RULES.liveIp, key)).locked) return fail('ip_locked', 429, 'rejected', { count: false });

	let body: unknown;
	try {
		const text = await event.request.text();
		if (text.length > BODY_MAX) return fail('body_too_large', 413, 'rejected');
		body = JSON.parse(text);
	} catch {
		return fail('bad_json', 400, 'rejected');
	}
	const parsed = parseLiveSessionRequest(body);
	if (!parsed.ok) return fail(parsed.error, 400, 'rejected');
	const req = parsed.req;
	mode = req.mode;

	const svc = partnerServiceClient();
	if (!svc) return fail('no_service', 503, 'unavailable', { count: false });

	let deviceId: string;
	let kind: LiveDeviceKind;
	let staff: { id: string; email: string | null } | null = null;

	if (req.mode === 'existing') {
		const { data, error } = await book(svc).from('live_devices').select('id, kind, public_key, revoked_at').eq('id', req.deviceId).maybeSingle<DeviceRow>();
		if (error) return fail('db_error', 500, 'rejected', { count: false });
		if (!data) return fail('unknown_device', 401, 'unknown_device');
		if (data.revoked_at) return fail('revoked', 403, 'revoked', { count: false });
		if (!(await verifyLiveSignature(data.public_key, req))) return fail('bad_sig', 401, 'rejected');
		if (data.kind === 'staff') {
			staff = await staffFromBearer(svc, headers);
			if (!staff) return fail('login_required', 401, 'login_required', { count: false });
		}
		const { data: touched, error: touchErr } = await book(svc).rpc('live_device_touch', { p_device_id: data.id, p_ts: req.ts, p_user_id: staff?.id ?? null });
		if (touchErr) return fail('db_error', 500, 'rejected', { count: false });
		if (touched === 'revoked') return fail('revoked', 403, 'revoked', { count: false, user: staff ?? undefined });
		if (touched === 'missing') return fail('unknown_device', 401, 'unknown_device');
		if (touched !== 'ok') return fail(String(touched ?? 'touch_failed'), 401, 'rejected', { user: staff ?? undefined });
		deviceId = data.id;
		kind = data.kind;
	} else {
		// 登録: 新しい鍵で署名できること（鍵を持っていること）を先に確かめる
		if (!(await verifyLiveSignature(req.publicKey, req))) return fail('bad_sig', 401, 'rejected');
		if (req.mode === 'register_staff') {
			staff = await staffFromBearer(svc, headers);
			if (!staff) return fail('login_required', 401, 'login_required', { count: false });
			const { data, error } = await book(svc).rpc('live_device_register_staff', { p_user_id: staff.id, p_public_key: req.publicKey, p_label: label, p_ts: req.ts });
			if (error) return fail(error.code === '23505' ? 'key_exists' : 'db_error', error.code === '23505' ? 409 : 500, 'rejected', { count: false, user: staff });
			deviceId = String(data);
			kind = 'staff';
		} else {
			const { data, error } = await book(svc).rpc('live_device_register_display', {
				p_code_hash: await hashLiveCode(req.code),
				p_public_key: req.publicKey,
				p_label: label,
				p_ts: req.ts
			});
			if (error) return fail(error.code === '23505' ? 'key_exists' : 'db_error', error.code === '23505' ? 409 : 500, 'rejected', { count: false });
			if (!data) return fail('bad_code', 403, 'bad_code');
			deviceId = String(data);
			kind = 'display';
		}
	}

	const exp = Math.floor(Date.now() / 1000) + LIVE_PASS_SECONDS;
	const token = await signLivePass({ deviceId, kind, userId: staff?.id ?? null, exp }, secret());
	event.cookies.set(LIVE_COOKIE, token, { path: '/live', httpOnly: true, secure: true, sameSite: 'strict', maxAge: LIVE_PASS_SECONDS });
	await rateReset(event.platform, RATE_RULES.liveIp, key);
	logAccessEvent(event, {
		event: 'login_success',
		user: staff,
		status: 200,
		detail: { method: 'live_session', mode, kind, device_id: deviceId, device: label }
	});
	return json(200, { deviceId, kind, expiresAt: exp });
}
