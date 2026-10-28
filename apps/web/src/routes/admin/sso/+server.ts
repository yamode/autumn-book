// デスクトップアプリ（autumn-pms desktop のタブ型シェル）からの管理画面シングルサインオン。
// POST のみ。ヘッダ: Authorization: Bearer <共有セッションの access_token>・x-autumn-desktop: <端末名 / アプリ版>
//   → 204（Book 専用 Cookie に新しいセッションを入れる）／401・403・429・503・500（本文なし）
// 設計: autumn-pms/desktop/docs/tabbed-shell-design.md §2.2・§2.8、docs/auth-hardening.md §7.5
//
// ★ブラウザ（ページ）からは使わせない: Origin / Referer 付きは 403（デスクトップのメインプロセスの fetch は付けない）
// ★本人確認は Supabase の認証サーバで access_token を確かめるだけ（リクエスト本文からメールなどは受け取らない）
// ★作るのは Book 専用の**独立した**セッション（refresh token は受け取らない・共有 Cookie はコピーしない）。
//   メールは送られない（generateLink の magiclink を、その場で verifyOtp に使う。パスキーのログインと同じ手）。
// ★セッションは aal1。二段階認証を登録済みの人は hooks の関所どおり /admin/mfa でコードを求められる（肩代わりしない）
// ★失敗は管理画面のログインと同じ「1 IP 10 回/10 分で 15 分止める」に数え、アクセスログに login_failure（desktop_sso_*）で残す
// ★2026-10-28（v0.196.0）: ブラウザ・デスクトップとも、共有 Cookie による自動ログイン（hooks・auth-hardening.md §7.6）が先に効く。
//   この口は将来 desktop を整理するときに廃止する。それまでは呼ばれても害がないように:
//   - 既に同じ人の Book セッションがあれば何もしない（204・新しいセッションを作らない）
//   - Book でログアウトした直後（ab_admin_sso_pause がこの共有セッションに効いている）は 403（シェルはログイン画面のまま）
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { clientIp, ipKey, RATE_RULES, rateCheck, rateHit, rateReset } from '$lib/server/login-rate-limit';
import { logAccessEvent } from '$lib/server/access-log';
import { desktopSsoPrecheck, desktopSsoUserProblem } from '$lib/admin-desktop-sso';
import { peekJwt } from '$lib/admin-shared-sso';
import { sharedSsoPausedFor } from '$lib/server/admin-shared-sso';

const HEADERS = { 'cache-control': 'no-store' };
const reply = (status: number) => new Response(null, { status, headers: HEADERS });

export const POST = async (event) => {
	// デモ認証の環境（AUTH_MODE=demo）では無い扱い（シェルは 404 を「未配備」とみなしてログイン画面のままにする）
	if (AUTH_MODE !== 'supabase') return reply(404);

	const ip = clientIp(event.request);
	const key = ipKey(ip);
	const pre = desktopSsoPrecheck(event.request.headers);
	const device = pre.ok ? pre.device : null;
	const failed = async (reason: string, status: number, opts: { count?: boolean; user?: { id: string; email?: string | null } } = {}) => {
		logAccessEvent(event, {
			event: 'login_failure',
			user: opts.user ?? null,
			status,
			detail: { reason: `desktop_sso_${reason}`, method: 'desktop_sso', device }
		});
		if (opts.count !== false) await rateHit(event.platform, RATE_RULES.adminIp, key);
		return reply(status);
	};

	if (!pre.ok) return failed(pre.reason, pre.status);
	if ((await rateCheck(event.platform, RATE_RULES.adminIp, key)).locked) return failed('ip_locked', 429, { count: false });

	const svc = partnerServiceClient();
	if (!svc) return failed('no_service', 503, { count: false });

	// access_token を認証サーバで確かめる（期限切れ・失効・別プロジェクトのトークンはここで落ちる）
	const { data: got, error: getErr } = await svc.auth.getUser(pre.token);
	const user = getErr ? null : got?.user ?? null;
	const problem = desktopSsoUserProblem(user as Parameters<typeof desktopSsoUserProblem>[0]);
	if (problem || !user?.email) {
		return failed(problem ?? 'invalid_jwt', problem === 'invalid_jwt' || !user ? 401 : 403, {
			user: user ? { id: user.id, email: user.email ?? null } : undefined
		});
	}

	// 既に同じ人の Book セッションがある（自動ログインが先に効いた等）なら作り直さない
	const cur = event.locals.user;
	if (cur && (cur.role === 'admin' || cur.role === 'staff') && cur.id === user.id) {
		await rateReset(event.platform, RATE_RULES.adminIp, key);
		return reply(204);
	}
	// Book でログアウトした直後は入れない（ブラウザの自動ログインと同じ扱い）
	const peek = peekJwt(pre.token);
	if (await sharedSsoPausedFor(event, { accessToken: pre.token, exp: peek?.exp ?? null, sessionId: peek?.sessionId ?? null })) {
		return failed('paused', 403, { count: false, user: { id: user.id, email: user.email } });
	}

	// Book 専用 Cookie に新しいセッションを作る（メールは送られない）
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
	logAccessEvent(event, {
		event: 'login_success',
		user: { id: user.id, email: user.email },
		status: 204,
		detail: { method: 'desktop_sso', device }
	});
	return reply(204);
};
