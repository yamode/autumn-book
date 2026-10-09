import { redirect } from '@sveltejs/kit';
import { resolveStay } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import type { RequestHandler } from './$types';

// 客室に常設する「客室案内の入口QR」（/r/start?f=<slug>）の着地点（2026-10-09）。
// QR はお客様ごとに変わらない（いつ読んでも同じ URL）。
//   ・この端末に有効な滞在（Cookie の ab_stay）があれば、そのまま客室案内（/r）へ。一度コードを入れた端末は次から入力不要
//   ・無い／前のご滞在で期限切れなら、Cookie を消して8桁コードの入力画面（/r）へ。前のご滞在の「終了」表示は出さない
// コードはチェックイン日の 12:00 〜 チェックアウト日の 11:00 だけ通る（book.claim_stay_by_code）。
const STAY_COOKIE = 'ab_stay';

export const GET: RequestHandler = async ({ cookies, url }) => {
	const slug = url.searchParams.get('f');
	const token = cookies.get(STAY_COOKIE);
	if (token) {
		const stay = DATA_SOURCE === 'supabase' ? await sbResolveStay(token) : resolveStay(token, getLocale());
		if (stay) redirect(302, '/r');
		cookies.delete(STAY_COOKIE, { path: '/' });
	}
	redirect(302, slug && /^[a-z0-9-]+$/.test(slug) ? `/r?f=${encodeURIComponent(slug)}` : '/r');
};
