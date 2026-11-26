import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { handleErrorWithSentry, initCloudflareSentryHandle, sentryHandle } from '@sentry/sveltekit';
import { SENTRY_DSN, SENTRY_TRACES_SAMPLE_RATE, scrubSentryEvent } from '$lib/sentry';
import { getSession } from '$lib/server/session';
import { AUTH_MODE, adminMfaRequired, createSupabaseServerClient, resolveRequestSessions } from '$lib/server/auth';
import { MEMBER_LOGIN_METHODS, memberSessionSecurity } from '$lib/server/member-login';
import { adminMfaRedirectTarget, decideAdminMfaGate } from '$lib/admin-mfa';
import { isMaintenanceOn, checkMaintenanceBypass, isPartnerPath, maintenancePageHtml } from '$lib/server/maintenance';
import { paraglideMiddleware } from '$lib/paraglide/server';
import '$lib/locale-strategy'; // 言語の持ち越し戦略（paraglideMiddleware より前に登録）
import { experimentsForRequest } from '$lib/server/experiments';
import { applySecurityHeaders } from '$lib/server/security-headers';
import { logAdminAccess } from '$lib/server/access-log';
import { trySharedCookieSso } from '$lib/server/admin-shared-sso';
import { isAdminPath } from '$lib/admin-mfa';
import { isFacilityScopedAdminPath } from '$lib/admin-facility-scope';
import { assignedFacilities, canOperateFacility } from '$lib/server/admin-facility-access';
import { currentBookFacility } from '$lib/server/partners/staff';
import { PRIMARY_ORIGIN } from '$lib/server/public-origin';
import { isBookingMcpMachineUrl, TOKEN_PATH } from '$lib/server/booking-mcp/oauth';
import { DATA_SOURCE } from '$lib/server/supabase';
import { seedPreviewMember } from '$lib/server/store';
import { acceptPreview, isPreviewExchange, isPreviewHost, memberPreviewSession, previewAdminOrigin, previewOrigin, updatePreview } from '$lib/server/member-preview';
import { dev } from '$app/environment';
import { isLivePath, LIVE_SESSION_PATH } from '$lib/live-pass';
import { readLivePass } from '$lib/server/live-session';

const LEGACY_HOST = 'autumn-book.pages.dev';

// すべての応答にセキュリティヘッダを付ける（security-headers.ts）
const appHandle: Handle = async (input) => {
	const { request, url } = input.event;
	if (!isPreviewExchange(input.event) && isCrossSiteForm(request, url)) {
		const message = `Cross-site ${request.method} form submissions are forbidden`;
		const response = request.headers.get('accept') === 'application/json'
			? Response.json({ message }, { status: 403 })
			: new Response(message, { status: 403 });
		return applySecurityHeaders(response, url);
	}
	if (isPreviewHost()) {
		const response = await handleMemberPreview(input);
		const headers = new Headers(response.headers);
		headers.set('cache-control', 'private, no-store');
		headers.set('x-robots-tag', 'noindex, nofollow');
		return applySecurityHeaders(new Response(response.body, { status: response.status, headers }), url);
	}
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

const previewPostPaths = [
	/^\/[^/]+\/[^/]+\/plans\/[^/]+$/,
	/^\/booking\/(hold|payment)$/,
	/^\/account\/favorites$/,
	/^\/account\/upgrades\/[^/]+$/,
	/^\/account\/reservations\/[^/]+(?:\/options)?$/
];

const handleMemberPreview: Handle = async ({ event, resolve }) => {
	const { url, request, locals } = event;
	if ((!dev && url.origin !== previewOrigin()) || DATA_SOURCE !== 'demo' || AUTH_MODE !== 'demo') {
		return new Response(null, { status: 404 });
	}
	if (isPreviewExchange(event)) return acceptPreview(event);
	const preview = await memberPreviewSession(event);
	if (!preview) {
		if (request.method === 'GET' && !event.isDataRequest) {
			return Response.redirect(`${previewAdminOrigin()}/admin/member-preview`, 303);
		}
		return new Response('プレビューの期限が切れました。管理画面から開き直してください。', { status: 403 });
	}
	const path = url.pathname.replace(/\/$/, '') || '/';
	if (isAdminPath(path) || isPartnerPath(path) || /^\/(api|booking-mcp|auth|p)(\/|$)/.test(path)) {
		return new Response('会員ランクのプレビュー対象外です。', { status: 404 });
	}
	if (request.method === 'POST' && path === '/member-preview/session' && request.headers.get('origin') === url.origin) {
		return updatePreview(event, preview);
	}
	if (!['GET', 'HEAD'].includes(request.method) && (request.method !== 'POST' || !previewPostPaths.some((route) => route.test(path)))) {
		return new Response('検証用の画面です。この操作はプレビューでは保存できません。', { status: 403 });
	}
	const member = seedPreviewMember(preview.id, preview.rank, preview.expires);
	locals.user = { id: member.id, name: member.name, role: 'member' };
	locals.memberPreview = preview.rank;
	locals.pendingAuthUser = null;
	locals.adminAal = null;
	locals.abExperiments = [];
	return paraglideMiddleware(request, ({ locale }) =>
		resolve(event, { transformPageChunk: ({ html }) => html.replace('%lang%', locale) })
	);
};

function isCrossSiteForm(request: Request, url: URL): boolean {
	if (request.method === 'POST' && url.pathname === TOKEN_PATH) return false;
	const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
	return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
		&& ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain', 'application/x-sveltekit-formdata'].includes(type)
		&& request.headers.get('origin') !== url.origin;
}

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

	// Autumn Live（閲覧専用のライブ画面・docs/autumn-live.md §4.4）。デスクトップアプリからだけ入る。
	// 会員・運営のセッションは解決しない（管理画面のログインでは入れない・入場券 ab_live だけを見る）。
	if (isLivePath(event.url.pathname)) return handleLive(event, resolve);

	const machineBookingMcp = isBookingMcpMachineUrl(event.url);
	if (machineBookingMcp || isPartnerPath(event.url.pathname)) {
		// 取引先専用ページ・取引先 API・Stripe Webhook・請求 cron は Supabase Auth を使わない
		// （独自セッション rms_partner_session / API キー / 署名 / CRON_SECRET で本人確認する）。
		// 会員・運営のセッションは解決しない（取引先ページに会員状態を持ち込まない）。
		event.locals.user = null;
		event.locals.pendingAuthUser = null;
		event.locals.adminAal = null;
		event.locals.staff = null;
	} else if (AUTH_MODE === 'supabase') {
		// admin/staff/member をすべて Supabase Auth の検証済みセッションからのみ解決する。
		// demo cookie は一切信用しない（偽造 cookie で誰にもなれない）。
		// OTP 認証済みだが未登録のユーザーは pendingAuthUser に載せ、/auth/register へ誘導する。
		// 管理画面と会員は別の cookie（2026-11-22・同じブラウザで両方にログインしても互いに上書きしない）。
		const authStarted = performance.now();
		const { user, pending, adminAal, staff } = await resolveRequestSessions(event);
		event.locals.authMs = performance.now() - authStarted;
		event.locals.user = user;
		event.locals.pendingAuthUser = pending;
		event.locals.adminAal = adminAal;
		event.locals.staff = staff;
		const memberId = user?.role === 'member' ? user.id : pending?.id;
		if (MEMBER_LOGIN_METHODS && memberId) {
			try {
				const security = await memberSessionSecurity(createSupabaseServerClient(event), memberId);
				if (!security.active || security.requiresMfa) event.locals.user = null;
				if (security.active) {
					event.locals.pendingAuthUser = null;
					if (security.requiresMfa) event.locals.memberMfaPending = { id: memberId, unavailable: false };
					else if (!user) event.locals.user = { id: memberId, name: pending?.email || 'ゲスト', role: 'member' };
				}
			} catch {
				event.locals.user = null;
				if (user?.role === 'member') event.locals.memberMfaPending = { id: memberId, unavailable: true };
			}
		}
	} else {
		event.locals.user = await getSession(event.cookies);
		event.locals.pendingAuthUser = null;
		event.locals.adminAal = null;
		event.locals.staff = null;
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
	// 施設の割り当ての関所（2026-11-24 指示）。割り当て外の施設を開いているあいだは、
	// 施設に紐づく画面を閲覧だけにする（テナント共通の画面はそのまま編集できる）。
	const facilityResponse = await adminFacilityGateResponse(event);
	if (facilityResponse) return facilityResponse;
	if (event.locals.memberMfaPending && !event.isDataRequest && event.request.method !== 'GET' && event.request.method !== 'HEAD'
		&& !['/(public)/auth/mfa', '/(public)/auth/logout', '/(public)/auth/passkey'].includes(event.route.id ?? '')) {
		return new Response(null, { status: 403, headers: { 'cache-control': 'no-store' } });
	}
	event.locals.abExperiments = experimentsForRequest(event);

	// メンテナンスモード: 有効かつバイパス対象外なら 503 メンテナンスページを返す。
	// （/admin 配下・運営ログイン中・プレビュートークン一致は isMaintenanceBypassed で通す）
	const bypass = !machineBookingMcp && (await isMaintenanceOn(event.platform)) ? await checkMaintenanceBypass(event) : { ok: true };
	// 合言葉（?preview=）を受け取ったら、cookie を発行して ?preview= を外した URL へ移す（履歴・共有・ログに残さない・レビュー L-2）
	// redirect を throw すると SvelteKit が event.cookies で発行した cookie を 303 に付けてくれる（Response を返すと付かない）
	if (bypass.redirect) redirect(303, bypass.redirect);
	if (!bypass.ok) {
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

const NO_STORE_TEXT = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' };

/**
 * /live 配下（docs/autumn-live.md §4.4）。
 *   POST /live/session … 入場の口（デスクトップアプリのメインプロセスから・中で署名を確かめる）。ほかのメソッドは 405
 *   それ以外           … 入場券（Cookie ab_live）があるときの GET / HEAD だけ。書き込みのメソッドは 405
 * 入場券が無ければ 403（ブラウザから開く道は残さない・ログイン画面へは送らない）。
 */
async function handleLive(event: Parameters<Handle>[0]['event'], resolve: Parameters<Handle>[0]['resolve']): Promise<Response> {
	event.locals.user = null;
	event.locals.pendingAuthUser = null;
	event.locals.adminAal = null;
	event.locals.staff = null;
	event.locals.abExperiments = [];
	const method = event.request.method;
	const path = event.url.pathname.replace(/\/$/, '') || '/';
	if (path === LIVE_SESSION_PATH) {
		if (method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } });
		event.locals.live = null;
		return resolve(event);
	}
	if (method !== 'GET' && method !== 'HEAD') {
		return new Response('Autumn Live は閲覧専用です。', { status: 405, headers: { ...NO_STORE_TEXT, allow: 'GET, HEAD' } });
	}
	event.locals.live = await readLivePass(event);
	if (!event.locals.live) {
		return new Response('Autumn Live は Autumn デスクトップアプリから開いてください。', { status: 403, headers: NO_STORE_TEXT });
	}
	const res = await resolve(event, { transformPageChunk: ({ html }) => html.replace('%lang%', 'ja') });
	const headers = new Headers(res.headers);
	headers.set('cache-control', 'private, no-store');
	headers.set('x-robots-tag', 'noindex, nofollow');
	return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

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

/**
 * 割り当て外の施設を開いているあいだ、施設に紐づく画面への書き込みを止める（2026-11-24 指示）。止めないなら null。
 *
 * 読む（GET / HEAD）のは止めない ＝ ほかの施設も「見るだけ」はできる。
 * テナント共通の画面（会員・クーポン・キャンセル規定など）は施設と関係がないので止めない。
 * 二段階認証の関所と同じく、レイアウトの load では届かないフォームの action・+server.ts を押さえるためここに置く。
 */
async function adminFacilityGateResponse(event: Parameters<Handle>[0]['event']): Promise<Response | null> {
	const method = event.request.method;
	if (method === 'GET' || method === 'HEAD') return null;
	const role = event.locals.user?.role;
	if (role !== 'admin' && role !== 'staff') return null;
	if (!isFacilityScopedAdminPath(event.url.pathname)) return null;
	const assigned = await assignedFacilities(event);
	if (assigned === 'all') return null;
	const current = currentBookFacility(event);
	if (canOperateFacility(assigned, current.id)) return null;
	return new Response(
		`いまは「${current.name}」を開いています。この施設はあなたの担当ではないため、閲覧だけになります。操作するには担当の施設に切り替えてください。`,
		{ status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }
	);
}

// エラー監視（Sentry・2026-11-23）。設定と個人情報の消し方は $lib/sentry.ts。ローカル（dev）では送らない
export const handle = sequence(
	initCloudflareSentryHandle({
		dsn: SENTRY_DSN,
		// 開発機の Node.js（vite preview・ビルド中の Miniflare など）からは送らない（2026-11-25 AUTUMN-BOOK-4）。本番の Cloudflare では送る
		enabled: !dev && !globalThis.navigator?.userAgent?.startsWith('Node.js'),
		environment: 'production',
		release: `autumn-book@${__APP_VERSION__}`,
		tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
		beforeSend: scrubSentryEvent
	}),
	sentryHandle(),
	appHandle
);

export const handleError = handleErrorWithSentry();
