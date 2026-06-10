import { error } from '@sveltejs/kit';
import { getFacilityBySlug, getRoomTypes } from '$lib/server/store';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');
	return { facility, rooms: getRoomTypes(facility.id, locale) };
};
