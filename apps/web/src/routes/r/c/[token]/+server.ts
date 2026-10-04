import { redirect } from '@sveltejs/kit';
import { resolveStay } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import { stayCookieMaxAge } from '$lib/server/stay-cookie';
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

	// stay_info は期限切れ・失効・存在しないを区別しない。発行形式（64桁の16進）の QR が
	// 解決できないのは、ほぼチェックアウト後の読み取り。サンクス表示（e=ended）へ回す。
	redirect(302, /^[0-9a-f]{64}$/i.test(token) ? '/r?e=ended' : '/r?e=invalid');
};
