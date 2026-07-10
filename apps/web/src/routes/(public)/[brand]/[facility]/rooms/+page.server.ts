import { error } from '@sveltejs/kit';
import { getFacilityBySlug, getRoomTypes } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityBySlug, sbListRoomTypesMapped } from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (DATA_SOURCE === 'supabase') {
		const facility = await sbFacilityBySlug(params.facility);
		if (!facility || facility.brandSlug !== params.brand) error(404, '施設が見つかりません');
		return { facility, rooms: await sbListRoomTypesMapped(facility.id) };
	}

	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');
	return { facility, rooms: getRoomTypes(facility.id, locale) };
};
