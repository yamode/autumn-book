import { error, redirect } from '@sveltejs/kit';
import { FACILITY_PAGE_PUBLIC } from '$lib/facility-page';
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
import * as m from '$lib/paraglide/messages';
import { clampCalendarMonth } from '$lib/calendar-range';
import { loadEarlyPrepaySettings } from '$lib/server/payment-settings';
import { viewerIsMember, withEarlyPrepayMax } from '$lib/server/direct-payments';
import { planForViewer } from '$lib/member-payment';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	// 施設のページは一旦非公開（2026-11-23・ユーザー決定）。施設の紹介は外部の公式サイトが受け持つ。
	// 公式サイトの「ご予約」などから日程付き（?checkin=&nights=&adults=）で来るリンクがあるので、404 にせずプラン一覧へ一時転送する。
	// 再公開するときは $lib/facility-page の FACILITY_PAGE_PUBLIC を true にする（下の読み込みはそのまま残してある）。
	if (!FACILITY_PAGE_PUBLIC) redirect(302, `${url.pathname.replace(/\/$/, '')}/plans${url.search}`);
	// 支払方法の表示は閲覧者（会員かどうか）に合わせる（非会員の支払方法）
	const isMember = viewerIsMember(locals);
	if (DATA_SOURCE === 'supabase') {
		const facility = await sbFacilityBySlug(params.facility);
		if (!facility || facility.brandSlug !== params.brand) error(404, m.error_facility_not_found());

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
	if (!facility) error(404, m.error_facility_not_found());

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
