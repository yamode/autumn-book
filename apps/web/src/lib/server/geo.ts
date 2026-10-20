// アクセス元の国（ISO 3166-1 alpha-2）。Cloudflare の request.cf（platform.cf）→ cf-ipcountry ヘッダの順。
// 分からなければ null。開発中は .env の DEV_GEO_COUNTRY で上書きできる（例: JP / DE）。
import type { RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

export function requestCountry(event: Pick<RequestEvent, 'request'> & { platform?: App.Platform }): string | null {
	if (dev && env.DEV_GEO_COUNTRY) return env.DEV_GEO_COUNTRY.toUpperCase();
	const cf = (event.platform as { cf?: { country?: unknown } } | undefined)?.cf;
	const country = typeof cf?.country === 'string' ? cf.country : event.request.headers.get('cf-ipcountry');
	return country ? country.toUpperCase() : null;
}
