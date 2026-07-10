import { searchAvailability } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityAvailability } from '$lib/server/supabase-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const checkin = url.searchParams.get('checkin') || undefined;
	const nights = Math.max(1, Number(url.searchParams.get('nights') ?? 1));
	const adults = Math.max(1, Number(url.searchParams.get('adults') ?? 2));

	const results =
		DATA_SOURCE === 'supabase'
			? await sbFacilityAvailability(checkin, nights, adults)
			: searchAvailability({ checkin, nights, adults, children: 0 });

	return { results, params: { checkin: checkin ?? '', nights, adults } };
};
