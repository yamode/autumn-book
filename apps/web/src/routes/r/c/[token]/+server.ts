import { redirect } from '@sveltejs/kit';
import { resolveStay } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import { stayCookieMaxAge } from '$lib/server/stay-cookie';
import { stayEndedFacility } from '$lib/server/inroom-banners';
import type { RequestHandler } from './$types';

// 印刷スリップの QR（/r/c/<token>）着地点。
// トークンを検証し、有効なら httpOnly Cookie（ab_stay）へ交換して /r へ 302。
// 以降 URL にトークンは出ない（履歴・共有からの漏洩を防ぐ）。無効なら /r?e=invalid。
const STAY_COOKIE = 'ab_stay';

export const GET: RequestHandler = async ({ params, cookies, url }) => {
	const token = params.token;
	// 検証のみ（有効判定）。滞在カードの表示は /r 側でロケール込みに再解決する。
	const stay = DATA_SOURCE === 'supabase' ? await sbResolveStay(token) : resolveStay(token, 'ja');

	if (stay) {
		cookies.set(STAY_COOKIE, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: stayCookieMaxAge(stay.validTo)
		});
		redirect(302, url.searchParams.get('next') === 'bath' ? '/r/bath' : '/r');
	}

	// チェックアウト後（期限切れ・失効）の QR はサンクス表示へ。施設は f=slug で渡す（バナーを施設別に出すため）
	const ended = await stayEndedFacility(token, 'ja');
	if (ended) redirect(302, `/r?e=ended&f=${encodeURIComponent(ended.slug)}`);

	redirect(302, '/r?e=invalid');
};
