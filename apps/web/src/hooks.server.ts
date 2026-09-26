import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/session';
import { AUTH_MODE, resolveSupabaseSessionUser } from '$lib/server/auth';
import { isMaintenanceOn, isMaintenanceBypassed, isPartnerPath, maintenancePageHtml } from '$lib/server/maintenance';
import { paraglideMiddleware } from '$lib/paraglide/server';

export const handle: Handle = async ({ event, resolve }) => {
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
