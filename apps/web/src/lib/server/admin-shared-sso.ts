// 共有セッション Cookie による管理画面の自動ログイン（docs/auth-hardening.md §7.6）。hooks.server.ts から呼ぶ。
//
// 流れ（Book のセッションが無いまま /admin を開いたときだけ）:
//   1. トップレベルのページ遷移か（isTopLevelNavigation）・対象のパスか（sharedSsoReturnTarget）
//   2. 共有 Cookie（sb-<ref>-auth-token・Domain=.yamado.app）から access_token だけを読む。期限切れなら何もしない
//   3. ログアウト直後の印（ab_admin_sso_pause）・同じトークンで失敗済みの印（ab_admin_sso_tried）があれば何もしない
//   4. 管理ログインと同じ IP 制限（RATE_RULES.adminIp）が掛かっていれば何もしない
//   5. auth.getUser(access_token) で確かめ、admin / staff・停止なし（デスクトップ SSO と同じ基準）
//   6. generateLink → verifyOtp で Book 専用 Cookie に**独立した新しいセッション**を作り、同じ画面へ 303
//   失敗したら印を付けて通常の処理（＝ログイン画面）へ落とす。同じリクエストの中で再試行しない。
//
// ★作るセッションは aal1。二段階認証を登録済みの人は 303 の先で hooks の関所どおり /admin/mfa を通る（肩代わりしない）
// ★access_token・Cookie の値はログに出さない。refresh_token は読まない
import { redirect, type RequestEvent } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { AUTH_MODE, createSupabaseServerClient } from './auth';
import { partnerServiceClient } from './partners/admin-client';
import { clientIp, ipKey, RATE_RULES, rateCheck, rateHit, rateReset } from './login-rate-limit';
import { logAccessEvent } from './access-log';
import { desktopSsoUserProblem } from '$lib/admin-desktop-sso';
import {
	fingerprint,
	isPaused,
	isTokenExpired,
	isTopLevelNavigation,
	PAUSE_ANY,
	readFingerprintCookie,
	readSharedAccessToken,
	SHARED_SSO_PAUSE_COOKIE,
	SHARED_SSO_PAUSE_SEC,
	SHARED_SSO_TRIED_COOKIE,
	SHARED_SSO_TRIED_SEC,
	sharedSsoReturnTarget,
	supabaseProjectRef,
	type SharedToken
} from '$lib/admin-shared-sso';

const COOKIE_BASE = { path: '/', httpOnly: true, sameSite: 'lax' as const };

/** このリクエストに届いた共有セッションの access_token（読めなければ null） */
export function sharedTokenOf(event: RequestEvent): SharedToken | null {
	return readSharedAccessToken(event.request.headers.get('cookie'), supabaseProjectRef(publicEnv.PUBLIC_SUPABASE_URL));
}

/** 共有セッションの指紋（ログアウトの印の値）。セッション id が読めなければ any */
async function sessionFpOf(token: SharedToken): Promise<string> {
	return token.sessionId ? fingerprint(token.sessionId) : PAUSE_ANY;
}

/**
 * Book でログアウトしたときに呼ぶ（routes/(public)/auth/logout）。
 * 共有 Cookie があれば「このセッションでは自動ログインしない」印を付ける（共有 Cookie が消えるか、
 * PMS で別のセッションにログインし直すか、12 時間たつと解ける）。
 */
export async function pauseSharedSso(event: RequestEvent): Promise<void> {
	if (AUTH_MODE !== 'supabase') return;
	const token = sharedTokenOf(event);
	if (!token) return;
	event.cookies.set(SHARED_SSO_PAUSE_COOKIE, await sessionFpOf(token), { ...COOKIE_BASE, maxAge: SHARED_SSO_PAUSE_SEC });
}

/** 手でログインし直したら印を外す（routes/admin/login の成功時） */
export function clearSharedSsoPause(event: RequestEvent): void {
	if (event.cookies.get(SHARED_SSO_PAUSE_COOKIE)) event.cookies.delete(SHARED_SSO_PAUSE_COOKIE, { path: '/' });
}

/** この共有セッションでの自動ログインがログアウトの印で止まっているか（/admin/sso でも使う） */
export async function sharedSsoPausedFor(event: RequestEvent, token: SharedToken | null): Promise<boolean> {
	const pause = readFingerprintCookie(event.cookies.get(SHARED_SSO_PAUSE_COOKIE));
	if (!pause || !token) return false;
	return isPaused(pause, await sessionFpOf(token));
}

/**
 * hooks から呼ぶ。自動ログインできたら同じ画面への 303 を投げる（redirect を throw ＝ SvelteKit が
 * 新しい Book の Cookie を応答に付ける）。何もしないときは普通に戻る。例外は外へ出さない。
 */
export async function trySharedCookieSso(event: RequestEvent): Promise<void> {
	if (AUTH_MODE !== 'supabase') return; // デモ認証の環境では動かさない
	if (event.locals.user || event.locals.pendingAuthUser) return; // Book のセッションがある（会員を含む）なら触らない
	if (event.isDataRequest) return;
	if (!isTopLevelNavigation(event.request.method, event.request.headers)) return;
	const target = sharedSsoReturnTarget(event.url.pathname, event.url.search);
	if (!target) return;

	let ok = false;
	try {
		ok = await attempt(event);
	} catch {
		ok = false; // どんな失敗でも通常のログイン画面へ（ループさせない）
	}
	if (ok) redirect(303, target);
}

async function attempt(event: RequestEvent): Promise<boolean> {
	const token = sharedTokenOf(event);
	if (!token) {
		// 共有 Cookie が消えた（PMS でログアウトした）ら、ログアウトの印も役目を終える
		if (event.cookies.get(SHARED_SSO_PAUSE_COOKIE)) event.cookies.delete(SHARED_SSO_PAUSE_COOKIE, { path: '/' });
		return false;
	}
	if (isTokenExpired(token.exp)) return false; // PMS を開けば更新される。認証サーバに問い合わせるまでもない
	if (await sharedSsoPausedFor(event, token)) return false; // Book でログアウトした直後

	const tokenFp = await fingerprint(token.accessToken);
	if (readFingerprintCookie(event.cookies.get(SHARED_SSO_TRIED_COOKIE)) === tokenFp) return false; // このトークンは失敗済み

	const ip = clientIp(event.request);
	const key = ipKey(ip);
	if ((await rateCheck(event.platform, RATE_RULES.adminIp, key)).locked) return false;

	const markTried = () => event.cookies.set(SHARED_SSO_TRIED_COOKIE, tokenFp, { ...COOKIE_BASE, maxAge: SHARED_SSO_TRIED_SEC });
	const failed = async (reason: string, status: number, opts: { count?: boolean; user?: { id: string; email?: string | null } } = {}) => {
		markTried();
		logAccessEvent(event, {
			event: 'login_failure',
			user: opts.user ?? null,
			status,
			detail: { reason: `shared_cookie_sso_${reason}`, method: 'shared_cookie_sso' }
		});
		if (opts.count !== false) await rateHit(event.platform, RATE_RULES.adminIp, key);
		return false;
	};

	const svc = partnerServiceClient();
	if (!svc) return failed('no_service', 503, { count: false });

	// access_token を認証サーバで確かめる（期限切れ・失効・別プロジェクトのトークンはここで落ちる）
	const { data: got, error: getErr } = await svc.auth.getUser(token.accessToken);
	const user = getErr ? null : got?.user ?? null;
	const problem = desktopSsoUserProblem(user as Parameters<typeof desktopSsoUserProblem>[0]);
	if (problem || !user?.email) {
		return failed(problem ?? 'invalid_jwt', problem === 'invalid_jwt' || !user ? 401 : 403, {
			user: user ? { id: user.id, email: user.email ?? null } : undefined
		});
	}

	// Book 専用 Cookie に新しいセッションを作る（magiclink はその場で使う＝メールは送られない）
	const { data: link, error: linkErr } = await svc.auth.admin.generateLink({ type: 'magiclink', email: user.email });
	const tokenHash = link?.properties?.hashed_token;
	if (linkErr || !tokenHash) return failed('generate_link', 500, { count: false, user: { id: user.id, email: user.email } });
	const client = createSupabaseServerClient(event);
	const { data: verified, error: otpErr } = await client.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
	if (otpErr || !verified.session || verified.user?.id !== user.id) {
		await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
		return failed('session_failed', 500, { count: false, user: { id: user.id, email: user.email } });
	}

	await rateReset(event.platform, RATE_RULES.adminIp, key);
	if (event.cookies.get(SHARED_SSO_TRIED_COOKIE)) event.cookies.delete(SHARED_SSO_TRIED_COOKIE, { path: '/' });
	logAccessEvent(event, {
		event: 'login_success',
		user: { id: user.id, email: user.email },
		status: 303,
		detail: { method: 'shared_cookie_sso' }
	});
	return true;
}
