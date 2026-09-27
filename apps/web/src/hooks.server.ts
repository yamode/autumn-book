import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/session';
import { AUTH_MODE, resolveSupabaseSessionUser } from '$lib/server/auth';
import { isMaintenanceOn, isMaintenanceBypassed, isPartnerPath, maintenancePageHtml } from '$lib/server/maintenance';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { experimentsForRequest } from '$lib/server/experiments';

const LEGACY_HOST = 'autumn-book.pages.dev';
const PRIMARY_ORIGIN = 'https://book.yamado.app';

export const handle: Handle = async ({ event, resolve }) => {
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
	} else if (AUTH_MODE === 'supabase') {
		// admin/staff/member をすべて Supabase Auth の検証済みセッションからのみ解決する。
		// demo cookie は一切信用しない（偽造 cookie で誰にもなれない）。
		// OTP 認証済みだが未登録のユーザーは pendingAuthUser に載せ、/auth/register へ誘導する。
		const { user, pending } = await resolveSupabaseSessionUser(event);
		event.locals.user = user;
		event.locals.pendingAuthUser = pending;
	} else {
		event.locals.user = getSession(event.cookies);
		event.locals.pendingAuthUser = null;
	}
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
