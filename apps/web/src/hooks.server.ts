import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/session';
import { AUTH_MODE, adminMfaRequired, resolveSupabaseSessionUser } from '$lib/server/auth';
import { adminMfaRedirectTarget, decideAdminMfaGate } from '$lib/admin-mfa';
import { isMaintenanceOn, isMaintenanceBypassed, isPartnerPath, maintenancePageHtml } from '$lib/server/maintenance';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { experimentsForRequest } from '$lib/server/experiments';
import { applySecurityHeaders } from '$lib/server/security-headers';
import { logAdminAccess } from '$lib/server/access-log';
import { trySharedCookieSso } from '$lib/server/admin-shared-sso';
import { isAdminPath } from '$lib/admin-mfa';

const LEGACY_HOST = 'autumn-book.pages.dev';
const PRIMARY_ORIGIN = 'https://book.yamado.app';

// すべての応答にセキュリティヘッダを付ける（security-headers.ts）
export const handle: Handle = async (input) => {
	const started = performance.now();
	let res: Response;
	try {
		res = applySecurityHeaders(await handleRequest(input), input.event.url);
	} catch (err) {
		// 管理画面のアクセスログ（例外で抜けたリダイレクト等もステータスを拾って残す）
		const status = (err as { status?: number })?.status;
		logAdminAccess(input.event, typeof status === 'number' ? status : 500);
		throw err;
	}
	// 管理画面のアクセスログ（core.access_logs・2026-10-22・/admin 配下だけ）
	logAdminAccess(input.event, res.status);
	// 管理画面だけ、処理時間の内訳を Server-Timing で返す（2026-10-18 高速化・ブラウザの開発者ツールの Network → Timing で見られる）
	if (input.event.url.pathname.startsWith('/admin')) {
		try {
			const auth = input.event.locals.authMs;
			res.headers.append('server-timing', `${auth !== undefined ? `auth;dur=${auth.toFixed(1)}, ` : ''}total;dur=${(performance.now() - started).toFixed(1)}`);
		} catch {
			// ヘッダーを足せない応答（リダイレクトの一部など）はそのまま
		}
	}
	return res;
};

const handleRequest: Handle = async ({ event, resolve }) => {
	// 本番ドメインは book.yamado.app（2026-09-26）。旧ドメイン（autumn-book.pages.dev 本体）で開かれたら同じパスへ転送する。
	// プレビューデプロイ（<hash>.autumn-book.pages.dev）はそのまま使えるよう、本体のホスト名だけを対象にする。
	// GET/HEAD 以外（フォーム送信・Webhook 等）は転送すると中身が失われるので、そのまま処理する。
	if (event.url.hostname === LEGACY_HOST && (event.request.method === 'GET' || event.request.method === 'HEAD')) {
		return new Response(null, {
			status: 301,
			headers: { location: `${PRIMARY_ORIGIN}${event.url.pathname}${event.url.search}` }
		});
	}

	if (isPartnerPath(event.url.pathname)) {
		// 取引先専用ページ・取引先 API・Stripe Webhook・請求 cron は Supabase Auth を使わない
		// （独自セッション rms_partner_session / API キー / 署名 / CRON_SECRET で本人確認する）。
		// 会員・運営のセッションは解決しない（取引先ページに会員状態を持ち込まない）。
		event.locals.user = null;
		event.locals.pendingAuthUser = null;
		event.locals.adminAal = null;
	} else if (AUTH_MODE === 'supabase') {
		// admin/staff/member をすべて Supabase Auth の検証済みセッションからのみ解決する。
		// demo cookie は一切信用しない（偽造 cookie で誰にもなれない）。
		// OTP 認証済みだが未登録のユーザーは pendingAuthUser に載せ、/auth/register へ誘導する。
		const authStarted = performance.now();
		const { user, pending, adminAal } = await resolveSupabaseSessionUser(event);
		event.locals.authMs = performance.now() - authStarted;
		event.locals.user = user;
		event.locals.pendingAuthUser = pending;
		event.locals.adminAal = adminAal;
	} else {
		event.locals.user = await getSession(event.cookies);
		event.locals.pendingAuthUser = null;
		event.locals.adminAal = null;
	}

	// 共有セッション Cookie による管理画面の自動ログイン（docs/auth-hardening.md §7.6）。
	// Book のセッションが無いまま /admin をページとして開いたとき、PMS / RMS / Order の共有 Cookie（Domain=.yamado.app）の
	// access_token を確かめて Book 専用の新しいセッションを作り、同じ画面へ 303（redirect を throw する）。
	// できないときは何もせず、下の通常の処理（レイアウトの load がログイン画面へ）に進む。
	if (isAdminPath(event.url.pathname)) await trySharedCookieSso(event);

	// 管理画面の二段階認証の関所（docs/auth-hardening.md §7.2）。
	// レイアウトの load は画面の表示にしか効かず、フォームの action・+server.ts（CSV・添付など）には効かないため、
	// ここで /admin 配下の全リクエストを止める。クライアント遷移のデータ要求（__data.json）は
	// routes/admin/+layout.server.ts の redirect に任せる（ここで 303 を返すと HTML が JSON として読まれて壊れる）。
	const mfaResponse = adminMfaGateResponse(event);
	if (mfaResponse) return mfaResponse;
	event.locals.abExperiments = experimentsForRequest(event);

	// メンテナンスモード: 有効かつバイパス対象外なら 503 メンテナンスページを返す。
	// （/admin 配下・運営ログイン中・プレビュートークン一致は isMaintenanceBypassed で通す）
	if ((await isMaintenanceOn(event.platform)) && !isMaintenanceBypassed(event)) {
		return paraglideMiddleware(
			event.request,
			({ locale }) =>
				new Response(maintenancePageHtml(locale), {
					status: 503,
					headers: {
						'content-type': 'text/html; charset=utf-8',
						'retry-after': '3600',
						'cache-control': 'no-store'
					}
				})
		);
	}

	// Paraglide ミドルウェアでロケールを確定し、%lang% プレースホルダを置換する
	return paraglideMiddleware(event.request, ({ locale }) =>
		resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%lang%', locale)
		})
	);
};

/** 二段階認証が済んでいない管理者/スタッフの /admin へのリクエストを止める。止めないなら null。 */
function adminMfaGateResponse(event: Parameters<Handle>[0]['event']): Response | null {
	if (!event.locals.adminAal || event.isDataRequest) return null;
	const gate = decideAdminMfaGate({
		pathname: event.url.pathname,
		role: event.locals.user?.role,
		aal: event.locals.adminAal,
		required: adminMfaRequired()
	});
	if (gate === 'ok') return null;
	const method = event.request.method;
	if (method === 'GET' || method === 'HEAD') {
		const target = adminMfaRedirectTarget(gate, event.url.pathname, event.url.search);
		return new Response(null, { status: 303, headers: { location: target ?? '/admin', 'cache-control': 'no-store' } });
	}
	// フォーム送信・API は画面遷移させず拒否する（確認が済んでから操作し直してもらう）
	return new Response(
		gate === 'challenge' ? '二段階認証のコードで本人確認をしてから操作してください。' : '二段階認証を登録してから操作してください。',
		{ status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }
	);
}
