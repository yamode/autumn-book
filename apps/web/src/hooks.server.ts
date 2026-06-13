import type { Handle } from '@sveltejs/kit';
import { getSession } from '$lib/server/session';
import { isMaintenanceOn, isMaintenanceBypassed, maintenancePageHtml } from '$lib/server/maintenance';
import { paraglideMiddleware } from '$lib/paraglide/server';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = getSession(event.cookies);

	// メンテナンスモード: 有効かつバイパス対象外なら 503 メンテナンスページを返す。
	// （/admin 配下・運営ログイン中・プレビュートークン一致は isMaintenanceBypassed で通す）
	if (isMaintenanceOn() && !isMaintenanceBypassed(event)) {
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
