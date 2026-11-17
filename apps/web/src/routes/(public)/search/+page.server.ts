import { searchAvailability } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityAvailability } from '$lib/server/supabase-data';
import { clampSearch } from '$lib/stay-search/params';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const checkin = url.searchParams.get('checkin') || undefined;
	const { nights, adults, rooms } = clampSearch({ nights: url.searchParams.get('nights'), adults: url.searchParams.get('adults'), rooms: url.searchParams.get('rooms') });

	const results =
		DATA_SOURCE === 'supabase'
			? await sbFacilityAvailability(checkin, nights, adults)
			: searchAvailability({ checkin, nights, adults, children: 0 });

	return { results, params: { checkin: checkin ?? '', nights, adults, rooms } };
};
