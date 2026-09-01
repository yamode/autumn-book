// 館内のご案内の詳細。トップのカードから1件ずつ開く。
//
// 現行の VERY travel と同じで、長い案内（ルームサービスのメニュー等）はトップに積まず
// 個別のページに置く。滞在の確認は /r と同じく httpOnly Cookie のトークンだけを見る。
import { error, redirect } from '@sveltejs/kit';
import { listHouseGuidesFor, resolveStay } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbListHouseGuides, sbResolveStay } from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

const STAY_COOKIE = 'ab_stay';

export const load: PageServerLoad = async ({ cookies, params }) => {
	const locale = getLocale();
	const token = cookies.get(STAY_COOKIE);
	// トークンが無い／失効しているときは、案内も出さずに /r（コード入力・終了案内）へ寄せる。
	if (!token) redirect(303, '/r');

	const stay = DATA_SOURCE === 'supabase' ? await sbResolveStay(token) : resolveStay(token, locale);
	if (!stay) redirect(303, '/r');

	const guides =
		DATA_SOURCE === 'supabase'
			? await sbListHouseGuides(stay.facility.id, locale)
			: listHouseGuidesFor(stay.facility.id, locale);

	const guide = guides.find((g) => g.id === params.id);
	if (!guide) redirect(303, '/r');

	return { stay, guide, headerTitle: guide.title, headerBack: '/r' };
};
