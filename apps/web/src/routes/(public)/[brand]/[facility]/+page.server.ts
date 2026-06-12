import { error } from '@sveltejs/kit';
import { getFacilityBySlug, getRoomTypes, getRatePlans, getFaqs, getPlanCalendar, getNews } from '$lib/server/store';
import { getLocale } from '$lib/paraglide/runtime';
import { clampCalendarMonth } from '$lib/calendar-range';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');

	const rooms = getRoomTypes(facility.id, locale);
	const plans = getRatePlans(facility.id, locale);

	const calendarNav = clampCalendarMonth(url.searchParams.get('cal'));
	const calMonth = calendarNav.yearMonth;
	const calendar = plans.length > 0 ? getPlanCalendar(plans[0].id, calMonth) : [];

	return {
		facility,
		rooms,
		plans,
		facilityFaqs: getFaqs(facility.id, locale),
		calMonth,
		calendarNav,
		calendar,
		news: getNews(facility.id, locale, 3),
		cheapestPlanId: plans[0]?.id ?? null
	};
};
