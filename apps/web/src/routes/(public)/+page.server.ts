import { brands, searchAvailability } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityAvailability } from '$lib/server/supabase-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	if (DATA_SOURCE === 'supabase') {
		// 日付未指定の参考料金で全施設を並べる（rate 未投入の施設は満室表示になるが 500 にはしない）
		const results = await sbFacilityAvailability(undefined, 1, 2);
		return { brands, results };
	}

	const results = searchAvailability({ nights: 1, adults: 2, children: 0 });
	return { brands, results };
};
