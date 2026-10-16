// 管理画面（/admin）のパスキー（WebAuthn）。@simplewebauthn/server の薄い包み。作りは取引先ページ（partners/passkeys.ts）と同じ。
//
// - 表は book.admin_passkeys / admin_passkey_challenges / admin_passkey_sessions（autumn-shared 20261016224412）。
//   service_role だけが触れるので、partnerServiceClient() を使う（admin-client.ts の冒頭コメント「例外その8」）。
//   呼ぶ側は必ず、getUser() で検証した本人の id（locals.user.id）を渡すこと。
// - 使えるのは本番ドメイン（PASSKEY_RP_ID＝book.yamado.app）とローカル（localhost）だけ。*.pages.dev のプレビューでは無効。
// - Supabase の aal クレームは認証アプリ（TOTP）でしか aal2 にならない。パスキーで確認したら、このセッション（JWT の session_id）を
//   admin_passkey_sessions に記録し、関所（hooks.server.ts → auth.ts readAdminAal）はそれも aal2 と同じに扱う（12 時間）。
// - パスキーでログイン（パスワード無し・UV 必須）: 署名を確かめたら、管理 API で作ったログイン用のトークン（generateLink の magiclink）を
//   すぐに verifyOtp で使って Supabase のセッションを作り、そのセッションをパスキーで確認済みにする。メールは送られない。
// - チャレンジは 1 回限り（未使用・期限内の行に used_at を立てられたときだけ使う）。検証に失敗しても使い切り。
// - counter は「読んだ値のままのとき」だけ進める（同時の使い回しで戻さない）。
// - 登録・削除・ログインは book.admin_audit_logs に残す（admin_passkey_registered / _removed / _login / _reset）。
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type AuthenticationResponseJSON,
	type RegistrationResponseJSON
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import {
	ADMIN_PASSKEY_MAX,
	ADMIN_PASSKEY_SESSION_HOURS,
	adminRoleOf,
	isBanned,
	isCredentialId,
	jwtSessionId,
	passkeyDeviceName,
	passkeyRelyingParty,
	type PasskeyRp
} from '$lib/admin-passkey';
import { summarizeUserAgent } from '$lib/partner-login-security';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { createSupabaseServerClient } from '$lib/server/auth';

// 山人テナント（admin-mfa.ts と同じ値）
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const REG_TTL_MINUTES = 5;
const AUTH_TTL_MINUTES = 5;
const LOGIN_TTL_MINUTES = 10;
// ES256・RS256・EdDSA（登録と検証で同じものを渡す）
const SUPPORTED_ALGS = [-7, -257, -8];
const UUID = /^[0-9a-f-]{36}$/i;

export class AdminPasskeyError extends Error {
	constructor(
		message: string,
		readonly status = 400
	) {
		super(message);
	}
}

type ChallengeKind = 'passkey_reg' | 'passkey_auth' | 'passkey_login';

export type AdminPasskeyRow = {
	id: string;
	user_id: string;
	credential_id: string;
	public_key: string;
	counter: number;
	transports: string[] | null;
	backed_up: boolean;
	device_name: string | null;
	created_at: string;
	last_used_at: string | null;
};
const COLUMNS = 'id, user_id, credential_id, public_key, counter, transports, backed_up, device_name, created_at, last_used_at';

/** 画面に出すパスキー（公開鍵などは含めない） */
export type AdminPasskeyView = { id: string; name: string; createdAt: string; lastUsedAt: string | null; backedUp: boolean };

/** このリクエストのホストで使う RP（使えなければ null）。本番は PASSKEY_RP_ID（wrangler.jsonc の vars） */
export function adminPasskeyRp(event: Pick<RequestEvent, 'url'>): PasskeyRp | null {
	return passkeyRelyingParty(event.url, env.PASSKEY_RP_ID);
}

/** パスキーを使えるか（ドメインと service_role の両方）。画面のボタンを出すかの判断にも使う */
export function adminPasskeyAvailable(event: Pick<RequestEvent, 'url'>): boolean {
	return Boolean(adminPasskeyRp(event) && partnerServiceClient());
}

function db(): SupabaseClient {
	const svc = partnerServiceClient();
	if (!svc) throw new AdminPasskeyError('サーバの設定（SUPABASE_SERVICE_ROLE_KEY）が無いため、パスキーは使えません。', 503);
	return svc;
}

const book = (svc: SupabaseClient) => svc.schema('book');

async function audit(svc: SupabaseClient, actorId: string, action: string, detail: Record<string, unknown>) {
	const { error } = await book(svc).from('admin_audit_logs').insert({ tenant_id: TENANT_ID, actor: actorId, action, detail });
	if (error) console.error('[admin-passkey] 監査ログを書けませんでした:', error.message);
}

const toView = (r: AdminPasskeyRow): AdminPasskeyView => ({
	id: r.id,
	name: r.device_name || 'パスキー',
	createdAt: r.created_at,
	lastUsedAt: r.last_used_at,
	backedUp: Boolean(r.backed_up)
});

async function listRows(svc: SupabaseClient, userId: string): Promise<AdminPasskeyRow[]> {
	const { data, error } = await book(svc).from('admin_passkeys').select(COLUMNS).eq('user_id', userId).order('created_at', { ascending: false });
	if (error) throw new AdminPasskeyError('パスキーを読み込めませんでした。', 500);
	return ((data ?? []) as AdminPasskeyRow[]).map((r) => ({ ...r, counter: Number(r.counter ?? 0) }));
}

/** 自分のパスキー（新しい順） */
export async function listAdminPasskeys(userId: string): Promise<AdminPasskeyView[]> {
	return (await listRows(db(), userId)).map(toView);
}

/**
 * 関所が毎回読む状態: パスキーの数と、このセッションがパスキーで確認済みか（book.admin_passkey_state・1 回の往復）。
 * service_role が無い・表がまだ無い・読めないときは「パスキーなし・未確認」（既存のログインを止めない）。
 */
export async function adminPasskeyState(userId: string, sessionId: string | null): Promise<{ passkeys: number; verified: boolean }> {
	const svc = partnerServiceClient();
	if (!svc) return { passkeys: 0, verified: false };
	try {
		const { data, error } = await book(svc).rpc('admin_passkey_state', { p_user_id: userId, p_session_id: sessionId });
		if (error || !data) {
			if (error) console.error('[admin-passkey] 状態を読めませんでした:', error.message);
			return { passkeys: 0, verified: false };
		}
		const d = data as { passkeys?: number; verified?: boolean };
		return { passkeys: Number(d.passkeys ?? 0), verified: d.verified === true && Boolean(sessionId) };
	} catch {
		return { passkeys: 0, verified: false };
	}
}

// ---------------------------------------------------------------------------
// チャレンジ
// ---------------------------------------------------------------------------

async function saveChallenge(svc: SupabaseClient, args: { userId: string | null; kind: ChallengeKind; challenge: string; ttlMinutes: number; ip: string | null }) {
	// 1 日より古いチャレンジの掃除（ついでに・失敗は無視）
	await book(svc)
		.from('admin_passkey_challenges')
		.delete()
		.lt('created_at', new Date(Date.now() - 86400_000).toISOString())
		.then(
			() => undefined,
			() => undefined
		);
	const id = crypto.randomUUID();
	const { error } = await book(svc)
		.from('admin_passkey_challenges')
		.insert({
			id,
			user_id: args.userId,
			kind: args.kind,
			challenge: args.challenge,
			expires_at: new Date(Date.now() + args.ttlMinutes * 60_000).toISOString(),
			ip: args.ip
		});
	if (error) throw new AdminPasskeyError('パスキーの準備ができませんでした。時間をおいてお試しください。', 500);
	return id;
}

/** チャレンジを使う（未使用・期限内のものに used_at を立てられたときだけ返す＝1 回限り）。持ち主（本人／ログイン用は null）で絞る */
async function takeChallenge(svc: SupabaseClient, args: { id: unknown; kind: ChallengeKind; userId: string | null }): Promise<string | null> {
	const id = String(args.id ?? '');
	if (!UUID.test(id)) return null;
	let q = book(svc)
		.from('admin_passkey_challenges')
		.update({ used_at: new Date().toISOString() })
		.eq('id', id)
		.eq('kind', args.kind)
		.is('used_at', null)
		.gt('expires_at', new Date().toISOString());
	q = args.userId === null ? q.is('user_id', null) : q.eq('user_id', args.userId);
	const { data, error } = await q.select('challenge');
	if (error) return null;
	return ((data ?? [])[0] as { challenge?: string } | undefined)?.challenge ?? null;
}

// ---------------------------------------------------------------------------
// このセッションをパスキーで確認済みにする
// ---------------------------------------------------------------------------

async function markSessionVerified(svc: SupabaseClient, args: { userId: string; sessionId: string; passkeyId: string | null }) {
	// 期限切れの印の掃除（ついでに）
	await book(svc)
		.from('admin_passkey_sessions')
		.delete()
		.lt('expires_at', new Date().toISOString())
		.then(
			() => undefined,
			() => undefined
		);
	const { error } = await book(svc)
		.from('admin_passkey_sessions')
		.upsert(
			{
				session_id: args.sessionId,
				user_id: args.userId,
				passkey_id: args.passkeyId,
				verified_at: new Date().toISOString(),
				expires_at: new Date(Date.now() + ADMIN_PASSKEY_SESSION_HOURS * 3600_000).toISOString()
			},
			{ onConflict: 'session_id' }
		);
	if (error) throw new AdminPasskeyError('確認の結果を保存できませんでした。もう一度お試しください。', 500);
}

/** いまの cookie のセッションの session_id（hooks が getUser() で検証済みのトークン） */
async function currentSessionId(event: RequestEvent): Promise<string | null> {
	const { data } = await createSupabaseServerClient(event).auth.getSession();
	return jwtSessionId(data.session?.access_token);
}

// ---------------------------------------------------------------------------
// 登録（/admin/security「パスキーを追加」）
// ---------------------------------------------------------------------------

export async function adminPasskeyRegistrationOptions(args: { userId: string; email: string; name: string; rp: PasskeyRp; ip: string | null }) {
	const svc = db();
	const existing = await listRows(svc, args.userId);
	if (existing.length >= ADMIN_PASSKEY_MAX) throw new AdminPasskeyError(`パスキーは ${ADMIN_PASSKEY_MAX} 個まで登録できます。使っていないものを削除してください。`, 409);
	const options = await generateRegistrationOptions({
		rpName: '山人 管理画面',
		rpID: args.rp.rpID,
		userName: args.email,
		// パスキーの候補に出る名前（取引先のパスキーと見分けられるように「管理画面」を添える）
		userDisplayName: `${args.name || args.email}（山人 管理画面）`,
		userID: new TextEncoder().encode(args.userId),
		timeout: REG_TTL_MINUTES * 60_000,
		attestationType: 'none',
		excludeCredentials: existing.map((p) => ({ id: p.credential_id, transports: (p.transports ?? undefined) as never })),
		// パスワード無しで入れるよう、端末に保存するパスキー（discoverable）を求める
		authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
		supportedAlgorithmIDs: SUPPORTED_ALGS
	});
	const challengeId = await saveChallenge(svc, { userId: args.userId, kind: 'passkey_reg', challenge: options.challenge, ttlMinutes: REG_TTL_MINUTES, ip: args.ip });
	return { challengeId, options };
}

/** 登録の応答を確かめて保存する。保存したら、このセッションをパスキーで確認済みにする（認証アプリの登録と同じ） */
export async function verifyAdminPasskeyRegistration(
	event: RequestEvent,
	args: { userId: string; challengeId: unknown; response: unknown; deviceName: unknown; rp: PasskeyRp; ip: string | null }
): Promise<AdminPasskeyView> {
	const svc = db();
	const challenge = await takeChallenge(svc, { id: args.challengeId, kind: 'passkey_reg', userId: args.userId });
	if (!challenge) throw new AdminPasskeyError('登録の有効期限が切れました。もう一度「パスキーを追加」からお試しください。');
	const response = args.response as RegistrationResponseJSON;
	if (!response || typeof response !== 'object' || !isCredentialId(response.id)) throw new AdminPasskeyError('パスキーを登録できませんでした。');
	let info;
	try {
		const v = await verifyRegistrationResponse({
			response,
			expectedChallenge: challenge,
			expectedOrigin: args.rp.origin,
			expectedRPID: args.rp.rpID,
			// 登録は preferred（PIN の無いセキュリティキーも登録できる）。パスワード無しのログインでは UV を求める
			requireUserVerification: false,
			supportedAlgorithmIDs: SUPPORTED_ALGS
		});
		if (!v.verified) throw new Error('not_verified');
		info = v.registrationInfo;
	} catch (e) {
		console.error('[admin-passkey] 登録の検証に失敗:', e instanceof Error ? e.message : String(e));
		throw new AdminPasskeyError('パスキーを登録できませんでした。');
	}
	const name = passkeyDeviceName(args.deviceName, summarizeUserAgent(event.request.headers.get('user-agent')));
	const { data, error } = await book(svc)
		.from('admin_passkeys')
		.insert({
			user_id: args.userId,
			credential_id: info.credential.id,
			public_key: isoBase64URL.fromBuffer(info.credential.publicKey),
			counter: info.credential.counter,
			transports: info.credential.transports ?? null,
			aaguid: info.aaguid,
			backed_up: info.credentialBackedUp,
			device_name: name
		})
		.select(COLUMNS)
		.single();
	if (error) {
		if (error.code === '23505') throw new AdminPasskeyError('このパスキーは既に登録されています。', 409);
		throw new AdminPasskeyError('パスキーを保存できませんでした。', 500);
	}
	const row = data as AdminPasskeyRow;
	await audit(svc, args.userId, 'admin_passkey_registered', { passkey_id: row.id, name, backed_up: info.credentialBackedUp, ip: args.ip });
	const sessionId = await currentSessionId(event);
	if (sessionId) await markSessionVerified(svc, { userId: args.userId, sessionId, passkeyId: row.id });
	return toView(row);
}

// ---------------------------------------------------------------------------
// 確認（/admin/mfa「パスキーで確認する」）
// ---------------------------------------------------------------------------

export async function adminPasskeyStepUpOptions(args: { userId: string; rp: PasskeyRp; ip: string | null }) {
	const svc = db();
	const list = await listRows(svc, args.userId);
	if (!list.length) throw new AdminPasskeyError('パスキーが登録されていません。');
	const options = await generateAuthenticationOptions({
		rpID: args.rp.rpID,
		allowCredentials: list.map((p) => ({ id: p.credential_id, transports: (p.transports ?? undefined) as never })),
		userVerification: 'preferred',
		timeout: AUTH_TTL_MINUTES * 60_000
	});
	const challengeId = await saveChallenge(svc, { userId: args.userId, kind: 'passkey_auth', challenge: options.challenge, ttlMinutes: AUTH_TTL_MINUTES, ip: args.ip });
	return { challengeId, options };
}

/** 署名を確かめ、counter を進める（読んだ値のままのときだけ）。通れば null、通らなければ理由 */
async function checkAssertion(
	svc: SupabaseClient,
	args: { passkey: AdminPasskeyRow; response: AuthenticationResponseJSON; challenge: string; rp: PasskeyRp; requireUserVerification: boolean }
): Promise<string | null> {
	try {
		const v = await verifyAuthenticationResponse({
			response: args.response,
			expectedChallenge: args.challenge,
			expectedOrigin: args.rp.origin,
			expectedRPID: args.rp.rpID,
			credential: {
				id: args.passkey.credential_id,
				publicKey: isoBase64URL.toBuffer(args.passkey.public_key),
				counter: args.passkey.counter,
				transports: (args.passkey.transports ?? undefined) as never
			},
			requireUserVerification: args.requireUserVerification
		});
		if (!v.verified) return 'not_verified';
		const { data } = await book(svc)
			.from('admin_passkeys')
			.update({ counter: v.authenticationInfo.newCounter, backed_up: v.authenticationInfo.credentialBackedUp, last_used_at: new Date().toISOString() })
			.eq('id', args.passkey.id)
			.eq('counter', args.passkey.counter)
			.select('id');
		// 同時に同じ counter で更新された（＝応答の使い回し）なら通さない
		return (data ?? []).length > 0 ? null : 'counter_conflict';
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error('[admin-passkey] 検証に失敗:', msg);
		return msg.slice(0, 160);
	}
}

async function findByCredential(svc: SupabaseClient, credentialId: string): Promise<AdminPasskeyRow | null> {
	const { data, error } = await book(svc).from('admin_passkeys').select(COLUMNS).eq('credential_id', credentialId).maybeSingle();
	if (error || !data) return null;
	const row = data as AdminPasskeyRow;
	return { ...row, counter: Number(row.counter ?? 0) };
}

/** 確認: 自分のパスキーの応答を確かめ、このセッションを確認済みにする */
export async function verifyAdminPasskeyStepUp(event: RequestEvent, args: { userId: string; challengeId: unknown; response: unknown; rp: PasskeyRp }) {
	const svc = db();
	const challenge = await takeChallenge(svc, { id: args.challengeId, kind: 'passkey_auth', userId: args.userId });
	if (!challenge) throw new AdminPasskeyError('確認の有効期限が切れました。もう一度お試しください。');
	const response = args.response as AuthenticationResponseJSON;
	if (!response || typeof response !== 'object' || !isCredentialId(response.id)) throw new AdminPasskeyError('パスキーで確認できませんでした。');
	const passkey = await findByCredential(svc, response.id);
	// 自分のパスキーだけ（別の人のパスキーでは通さない）
	if (!passkey || passkey.user_id !== args.userId) throw new AdminPasskeyError('このアカウントのパスキーではありません。登録したパスキーを選んでください。');
	const reason = await checkAssertion(svc, { passkey, response, challenge, rp: args.rp, requireUserVerification: false });
	if (reason) throw new AdminPasskeyError('パスキーで確認できませんでした。もう一度お試しください。');
	const sessionId = await currentSessionId(event);
	if (!sessionId) throw new AdminPasskeyError('ログインの状態を確かめられませんでした。もう一度ログインしてください。', 401);
	await markSessionVerified(svc, { userId: args.userId, sessionId, passkeyId: passkey.id });
}

// ---------------------------------------------------------------------------
// ログイン（/admin/login「パスキーでログイン」・パスワード無し）
// ---------------------------------------------------------------------------

/** 誰のパスキーでもよい options（allowCredentials 無し＝端末に保存されたパスキーから選ぶ・Conditional UI 兼用）。UV 必須 */
export async function adminPasskeyLoginOptions(args: { rp: PasskeyRp; ip: string | null }) {
	const svc = db();
	const options = await generateAuthenticationOptions({ rpID: args.rp.rpID, userVerification: 'required', timeout: LOGIN_TTL_MINUTES * 60_000 });
	const challengeId = await saveChallenge(svc, { userId: null, kind: 'passkey_login', challenge: options.challenge, ttlMinutes: LOGIN_TTL_MINUTES, ip: args.ip });
	return { challengeId, options };
}

/**
 * ログイン: パスキーの応答を確かめ、持ち主が今も admin / staff で停止されていなければ、Supabase のセッションを作って cookie に載せる。
 * だめなら理由（ログ用）。画面には理由を出さない（呼ぶ側が同じ文言を返す）。
 */
export async function loginWithAdminPasskey(
	event: RequestEvent,
	args: { challengeId: unknown; response: unknown; rp: PasskeyRp; ip: string | null }
): Promise<{ ok: true } | { ok: false; reason: string }> {
	const svc = db();
	const challenge = await takeChallenge(svc, { id: args.challengeId, kind: 'passkey_login', userId: null });
	if (!challenge) return { ok: false, reason: 'challenge_expired' };
	const response = args.response as AuthenticationResponseJSON;
	if (!response || typeof response !== 'object' || !isCredentialId(response.id)) return { ok: false, reason: 'bad_response' };
	const passkey = await findByCredential(svc, response.id);
	if (!passkey) return { ok: false, reason: 'unknown_credential' };
	const reason = await checkAssertion(svc, { passkey, response, challenge, rp: args.rp, requireUserVerification: true });
	if (reason) return { ok: false, reason: `verify_failed:${reason}` };

	// 持ち主が今も管理画面のアカウントか（権限を外された・停止された人は入れない）
	const { data: got, error: getErr } = await svc.auth.admin.getUserById(passkey.user_id);
	const user = got?.user;
	if (getErr || !user?.email) return { ok: false, reason: 'user_missing' };
	if (!adminRoleOf(user.app_metadata)) return { ok: false, reason: 'not_staff' };
	if (isBanned((user as { banned_until?: string | null }).banned_until)) return { ok: false, reason: 'banned' };

	// ログイン用のトークンを作り、すぐに使ってセッションにする（メールは送られない）
	const { data: link, error: linkErr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: user.email });
	const tokenHash = link?.properties?.hashed_token;
	if (linkErr || !tokenHash) return { ok: false, reason: `generate_link:${linkErr?.message ?? 'no_token'}` };
	const client = createSupabaseServerClient(event);
	const { data: verified, error: otpErr } = await client.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
	if (otpErr || !verified.session || verified.user?.id !== user.id) return { ok: false, reason: `verify_otp:${otpErr?.message ?? 'no_session'}` };
	const sessionId = jwtSessionId(verified.session.access_token);
	if (!sessionId) {
		await client.auth.signOut().catch(() => undefined);
		return { ok: false, reason: 'no_session_id' };
	}
	try {
		await markSessionVerified(svc, { userId: user.id, sessionId, passkeyId: passkey.id });
	} catch {
		await client.auth.signOut().catch(() => undefined);
		return { ok: false, reason: 'mark_failed' };
	}
	await audit(svc, user.id, 'admin_passkey_login', { passkey_id: passkey.id, name: passkey.device_name, ip: args.ip });
	return { ok: true };
}

// ---------------------------------------------------------------------------
// 削除（本人・/admin/security）と、別の管理者による全削除（/admin/security/users）
// ---------------------------------------------------------------------------

export async function removeAdminPasskey(args: { userId: string; passkeyId: string; ip: string | null }) {
	if (!UUID.test(args.passkeyId)) throw new AdminPasskeyError('パスキーが見つかりません。', 404);
	const svc = db();
	const { data, error } = await book(svc).from('admin_passkeys').delete().eq('id', args.passkeyId).eq('user_id', args.userId).select('id, device_name');
	if (error) throw new AdminPasskeyError('パスキーを削除できませんでした。', 500);
	const row = (data ?? [])[0] as { id: string; device_name: string | null } | undefined;
	if (!row) throw new AdminPasskeyError('パスキーが見つかりません。', 404);
	await audit(svc, args.userId, 'admin_passkey_removed', { passkey_id: row.id, name: row.device_name, ip: args.ip });
	return row.device_name || 'パスキー';
}

/** 管理者・スタッフごとのパスキーの数（/admin/security/users の一覧） */
export async function countAdminPasskeysByUser(): Promise<Map<string, number>> {
	const svc = partnerServiceClient();
	const out = new Map<string, number>();
	if (!svc) return out;
	const { data, error } = await book(svc).from('admin_passkeys').select('user_id');
	if (error) return out;
	for (const r of (data ?? []) as { user_id: string }[]) out.set(r.user_id, (out.get(r.user_id) ?? 0) + 1);
	return out;
}

/** 別の管理者が、対象のパスキーと「確認済み」の印を全部消す（復旧）。監査ログを書いてから消す。消した数を返す */
export async function resetAdminPasskeys(args: { actorId: string; targetUserId: string; targetEmail: string | null }): Promise<number> {
	const svc = db();
	const { data: rows, error: listErr } = await book(svc).from('admin_passkeys').select('id').eq('user_id', args.targetUserId);
	if (listErr) throw new AdminPasskeyError('パスキーを読み込めませんでした。', 502);
	const ids = ((rows ?? []) as { id: string }[]).map((r) => r.id);
	if (!ids.length) return 0;
	const { error: auditErr } = await book(svc)
		.from('admin_audit_logs')
		.insert({ tenant_id: TENANT_ID, actor: args.actorId, action: 'admin_passkey_reset', detail: { target_user_id: args.targetUserId, target_email: args.targetEmail, passkey_ids: ids } });
	if (auditErr) throw new AdminPasskeyError(`監査ログを記録できなかったため、削除を中止しました（${auditErr.message}）`, 502);
	const { error } = await book(svc).from('admin_passkeys').delete().eq('user_id', args.targetUserId);
	if (error) throw new AdminPasskeyError('パスキーを削除できませんでした。', 502);
	await book(svc).from('admin_passkey_sessions').delete().eq('user_id', args.targetUserId);
	return ids.length;
}
