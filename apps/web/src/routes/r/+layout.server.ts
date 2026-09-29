import { resolveStay } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import { loadSnsLinks } from '$lib/server/sns-links';
import { getLocale } from '$lib/paraglide/runtime';
import type { LayoutServerLoad } from './$types';

// フッターの SNS ボタン用。滞在（Cookie の ab_stay）が確定している施設のぶんだけ返す。
export const load: LayoutServerLoad = async ({ cookies }) => {
	const token = cookies.get('ab_stay');
	if (!token) return { snsLinks: {} };
	const stay = DATA_SOURCE === 'supabase' ? await sbResolveStay(token) : resolveStay(token, getLocale());
	return { snsLinks: stay ? await loadSnsLinks(stay.facility.id) : {} };
};
