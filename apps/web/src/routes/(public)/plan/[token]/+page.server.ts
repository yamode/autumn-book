// プランの専用 URL（/plan/<token>・シークレットプラン）。管理画面のプラン編集で発行・コピーする。
// トークンが有効なら Cookie に覚えてプラン詳細へ移る（URL 限定のプランも、以後この端末では見られて予約できる）。
// 会員限定・グレードの条件はプラン詳細と仮押さえで判定する（ここでは URL を開いたことだけを覚える）。
import { redirect } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityByUuid } from '$lib/server/supabase-data';
import { facilityById } from '$lib/server/store';
import { planOfShareToken, rememberLinkToken } from '$lib/server/secret-plans';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies, setHeaders }) => {
	// トークン入りの URL を検索エンジン・共有キャッシュに残さない
	setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
	const plan = await planOfShareToken(params.token).catch(() => undefined);
	const facility = plan
		? DATA_SOURCE === 'supabase'
			? await sbFacilityByUuid(plan.facilityId).catch(() => undefined)
			: facilityById(plan.facilityId)
		: undefined;
	if (!plan || !facility) return { invalid: true as const };
	rememberLinkToken(cookies, params.token);
	redirect(303, `/${facility.brandSlug}/${facility.slug}/plans/${plan.slug}`);
};
