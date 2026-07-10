import { redirect } from '@sveltejs/kit';
import { resolveStay } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import type { RequestHandler } from './$types';

// 印刷スリップの QR（/r/c/<token>）着地点。
// トークンを検証し、有効なら httpOnly Cookie（ab_stay）へ交換して /r へ 302。
// 以降 URL にトークンは出ない（履歴・共有からの漏洩を防ぐ）。無効なら /r?e=invalid。
const STAY_COOKIE = 'ab_stay';
const STAY_MAXAGE = 60 * 60 * 24 * 3; // ≒チェックアウトまで

export const GET: RequestHandler = async ({ params, cookies }) => {
	const token = params.token;
	// 検証のみ（有効判定）。滞在カードの表示は /r 側でロケール込みに再解決する。
	const stay = DATA_SOURCE === 'supabase' ? await sbResolveStay(token) : resolveStay(token, 'ja');

	if (stay) {
		cookies.set(STAY_COOKIE, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: STAY_MAXAGE
		});
		redirect(302, '/r');
	}

	redirect(302, '/r?e=invalid');
};
