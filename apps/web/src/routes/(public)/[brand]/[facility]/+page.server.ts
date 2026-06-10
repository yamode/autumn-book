import { error } from '@sveltejs/kit';
import { getFacilityBySlug, getRoomTypes, getRatePlans, getFaqs, getPlanCalendar } from '$lib/server/store';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');

	const rooms = getRoomTypes(facility.id, locale);
	const plans = getRatePlans(facility.id, locale);

	const calMonth = url.searchParams.get('cal') ?? new Date().toISOString().slice(0, 7);
	const calendar = plans.length > 0 ? getPlanCalendar(plans[0].id, calMonth) : [];

	return {
		facility,
		rooms,
		plans,
		facilityFaqs: getFaqs(facility.id, locale),
		calMonth,
		calendar,
		cheapestPlanId: plans[0]?.id ?? null
	};
};
