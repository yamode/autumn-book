import { error } from '@sveltejs/kit';
import { getFacilityBySlug, getRoomTypes, getRatePlans } from '$lib/server/store';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');
	const room = getRoomTypes(facility.id, locale).find((r) => r.slug === params.room);
	if (!room) error(404, '客室が見つかりません');
	const plans = getRatePlans(facility.id, locale).filter((p) => p.roomTypeIds.includes(room.id));
	return { facility, room, plans };
};
