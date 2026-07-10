import { error } from '@sveltejs/kit';
import { getFacilityBySlug, getRoomTypes, getRatePlans, getFaqs, getPlanCalendar, getNews } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import {
	sbFacilityBySlug,
	sbListRoomTypesMapped,
	sbListPlansMapped,
	sbListFaqsMapped,
	sbListNewsMapped,
	getPlanCalendar as sbGetPlanCalendar
} from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import { clampCalendarMonth } from '$lib/calendar-range';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	if (DATA_SOURCE === 'supabase') {
		const facility = await sbFacilityBySlug(params.facility);
		if (!facility || facility.brandSlug !== params.brand) error(404, '施設が見つかりません');

		const [rooms, plans, facilityFaqs, news] = await Promise.all([
			sbListRoomTypesMapped(facility.id),
			sbListPlansMapped(facility.id),
			sbListFaqsMapped(facility.id),
			sbListNewsMapped(facility.id, 3)
		]);

		// deep-link: checkin があればカレンダー初期月に反映
		const checkin = url.searchParams.get('checkin') ?? undefined;
		const calendarNav = clampCalendarMonth(url.searchParams.get('cal') ?? checkin?.slice(0, 7));
		const calMonth = calendarNav.yearMonth;
		const calendar = plans.length > 0 ? await sbGetPlanCalendar(plans[0].id, calMonth) : [];

		return {
			facility,
			rooms,
			plans,
			facilityFaqs,
			calMonth,
			calendarNav,
			calendar,
			news,
			cheapestPlanId: plans[0]?.id ?? null
		};
	}

	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');

	const rooms = getRoomTypes(facility.id, locale);
	const plans = getRatePlans(facility.id, locale);

	// deep-link（autumn_book_deeplink_contract.md）: checkin があればカレンダー初期月に反映
	const checkin = url.searchParams.get('checkin') ?? undefined;
	const calendarNav = clampCalendarMonth(url.searchParams.get('cal') ?? checkin?.slice(0, 7));
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
