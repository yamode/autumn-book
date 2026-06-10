import { error } from '@sveltejs/kit';
import { facilityBySlug, roomTypes, ratePlans, faqs, getPlanCalendar } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const facility = facilityBySlug(params.brand, params.facility);
	if (!facility) error(404, '施設が見つかりません');

	const rooms = roomTypes.filter((r) => r.facilityId === facility.id);
	const plans = ratePlans
		.filter((p) => p.facilityId === facility.id && p.isPublished)
		.sort((a, b) => a.sortOrder - b.sortOrder);

	const calMonth = url.searchParams.get('cal') ?? new Date().toISOString().slice(0, 7);
	const calendar = plans.length > 0 ? getPlanCalendar(plans[0].id, calMonth) : [];

	return {
		facility,
		rooms,
		plans,
		facilityFaqs: faqs.filter((q) => q.facilityId === facility.id && q.isPublished).sort((a, b) => a.sortOrder - b.sortOrder),
		calMonth,
		calendar,
		cheapestPlanId: plans[0]?.id ?? null
	};
};
