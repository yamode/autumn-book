import { searchAvailability } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityAvailability } from '$lib/server/supabase-data';
import { parseChildren } from '$lib/components/guests';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const checkin = url.searchParams.get('checkin') || undefined;
	const nights = Math.max(1, Number(url.searchParams.get('nights') ?? 1));
	const adults = Math.max(1, Number(url.searchParams.get('adults') ?? 2));
	// 子どもの人数（未指定は 0）。実データ（supabase）の search_availability は子ども未対応のため大人のみで検索する
	const children = parseChildren(url.searchParams.get('children'));
	const childrenSupported = DATA_SOURCE !== 'supabase';

	const results =
		DATA_SOURCE === 'supabase'
			? await sbFacilityAvailability(checkin, nights, adults)
			: searchAvailability({ checkin, nights, adults, children });

	return { results, childrenSupported, params: { checkin: checkin ?? '', nights, adults, children } };
};
