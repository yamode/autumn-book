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
import { loadEarlyPrepaySettings } from '$lib/server/payment-settings';
import { viewerIsMember, withEarlyPrepayMax } from '$lib/server/direct-payments';
import { planForViewer } from '$lib/member-payment';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	// 支払方法の表示は閲覧者（会員かどうか）に合わせる（非会員の支払方法）
	const isMember = viewerIsMember(locals);
	if (DATA_SOURCE === 'supabase') {
		const facility = await sbFacilityBySlug(params.facility);
		if (!facility || facility.brandSlug !== params.brand) error(404, '施設が見つかりません');

		const [rooms, rawPlans, facilityFaqs, news, early] = await Promise.all([
			sbListRoomTypesMapped(facility.id),
			sbListPlansMapped(facility.id),
			sbListFaqsMapped(facility.id),
			sbListNewsMapped(facility.id, 3),
			loadEarlyPrepaySettings(facility.id)
		]);
		// 早期決済割の対象プランは「予約時決済で最大 N%お得」を出す
		const plans = withEarlyPrepayMax(rawPlans.map((p) => planForViewer(p, isMember)), early);

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
	const plans = withEarlyPrepayMax(
		getRatePlans(facility.id, locale).map((p) => planForViewer(p, isMember)),
		await loadEarlyPrepaySettings(facility.id)
	);

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
