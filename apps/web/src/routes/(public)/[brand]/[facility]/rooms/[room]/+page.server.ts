import { error } from '@sveltejs/kit';
import { facilityBySlug, roomTypes, ratePlans } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const facility = facilityBySlug(params.brand, params.facility);
	if (!facility) error(404, '施設が見つかりません');
	const room = roomTypes.find((r) => r.facilityId === facility.id && r.slug === params.room);
	if (!room) error(404, '客室が見つかりません');
	const plans = ratePlans
		.filter((p) => p.facilityId === facility.id && p.isPublished && p.roomTypeIds.includes(room.id))
		.sort((a, b) => a.sortOrder - b.sortOrder);
	return { facility, room, plans };
};
