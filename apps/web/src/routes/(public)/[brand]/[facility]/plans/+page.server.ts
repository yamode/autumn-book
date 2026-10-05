import { error } from '@sveltejs/kit';
import { getFacilityBySlug, getRatePlans, getRoomTypes, remainingRooms, quoteFor } from '$lib/server/store';
import { stayCalendar, todayJst } from '$lib/server/stay-calendar';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityBySlug, sbListPlansMapped, sbListRoomTypesMapped, sbPlanOffers, sbRoomPlanReferencePrices } from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import { eachNight } from '@autumn-book/core';
import { loadEarlyPrepaySettings } from '$lib/server/payment-settings';
import { viewerIsMember, withEarlyPrepayMax } from '$lib/server/direct-payments';
import { planForViewer } from '$lib/member-payment';
import type { RatePlan, RoomType } from '$lib/types';
import type { PageServerLoad } from './$types';

type RoomPlanPrice = {
	ratePlanId: string;
	roomTypeId: string;
	total: number | null;
	referencePrice: number | null;
	remaining: number | null;
};

function roomsWithPlans(rooms: RoomType[], plans: RatePlan[], prices: RoomPlanPrice[], adults: number) {
	const planById = new Map(plans.map((plan) => [plan.id, plan]));
	const pricesByRoom = new Map<string, RoomPlanPrice[]>();
	for (const price of prices) {
		const rows = pricesByRoom.get(price.roomTypeId) ?? [];
		rows.push(price);
		pricesByRoom.set(price.roomTypeId, rows);
	}
	return rooms
		.filter((room) => room.capacity >= adults)
		.map((room) => ({
			room,
			plans: (pricesByRoom.get(room.id) ?? [])
				.map((price) => {
					const plan = planById.get(price.ratePlanId);
					return plan ? { plan, total: price.total, referencePrice: price.referencePrice, remaining: price.remaining } : null;
				})
				.filter((item): item is NonNullable<typeof item> => item !== null)
				.sort((a, b) => (a.total ?? a.referencePrice ?? Infinity) - (b.total ?? b.referencePrice ?? Infinity))
		}))
		.sort((a, b) => Number(b.plans.length > 0) - Number(a.plans.length > 0));
}

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const isMember = viewerIsMember(locals);
	const checkin = url.searchParams.get('checkin') || undefined;
	const nights = Math.min(7, Math.max(1, Number(url.searchParams.get('nights') ?? 1)));
	const adults = Math.min(6, Math.max(1, Number(url.searchParams.get('adults') ?? 2)));
	const tag = url.searchParams.get('tag') || undefined;
	const today = todayJst();

	if (DATA_SOURCE === 'supabase') {
		const facility = await sbFacilityBySlug(params.facility);
		if (!facility || facility.brandSlug !== params.brand) error(404, '施設が見つかりません');
		const [allPlans, allRooms, settings, datedOffers, referencePrices, calendar] = await Promise.all([
			sbListPlansMapped(facility.id),
			sbListRoomTypesMapped(facility.id),
			loadEarlyPrepaySettings(facility.id),
			checkin ? sbPlanOffers(facility.id, checkin, nights, adults) : Promise.resolve([]),
			checkin ? Promise.resolve([]) : sbRoomPlanReferencePrices(facility.id, adults),
			stayCalendar(facility.id, nights, adults)
		]);
		const allTags = [...new Set(allPlans.flatMap((plan) => plan.highlightTags))];
		const plans = withEarlyPrepayMax(
			allPlans.filter((plan) => !tag || plan.highlightTags.includes(tag)).map((plan) => planForViewer(plan, isMember)),
			settings
		);
		const prices: RoomPlanPrice[] = checkin
			? datedOffers.map((offer) => ({ ratePlanId: offer.ratePlanId, roomTypeId: offer.roomTypeId, total: offer.total, referencePrice: null, remaining: offer.remaining }))
			: referencePrices.map((price) => ({ ratePlanId: price.ratePlanId, roomTypeId: price.roomTypeId, total: null, referencePrice: price.minPerPerson, remaining: null }));
		return {
			facility,
			rooms: roomsWithPlans(allRooms, plans, prices, adults),
			allTags,
			calendarDays: calendar.days,
			calendarThrough: calendar.through,
			today,
			referenceMode: !checkin,
			params: { checkin: checkin ?? '', nights, adults, tag: tag ?? '' }
		};
	}

	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');
	const allPlans = getRatePlans(facility.id, locale);
	const allTags = [...new Set(allPlans.flatMap((plan) => plan.highlightTags))];
	const plans = withEarlyPrepayMax(
		allPlans.filter((plan) => !tag || plan.highlightTags.includes(tag)).map((plan) => planForViewer(plan, isMember)),
		await loadEarlyPrepaySettings(facility.id)
	);
	const prices: RoomPlanPrice[] = [];
	for (const plan of plans) {
		for (const roomTypeId of plan.roomTypeIds) {
			if (!checkin) {
				prices.push({ ratePlanId: plan.id, roomTypeId, total: null, referencePrice: plan.basePrice, remaining: null });
				continue;
			}
			const remaining = Math.min(...eachNight(checkin, nights).map((date) => remainingRooms(roomTypeId, date)));
			if (remaining <= 0) continue;
			const quote = quoteFor(plan.id, roomTypeId, checkin, nights, adults, 0);
			prices.push({ ratePlanId: plan.id, roomTypeId, total: quote.total, referencePrice: null, remaining });
		}
	}
	const calendar = await stayCalendar(facility.id, nights, adults);
	return {
		facility,
		rooms: roomsWithPlans(getRoomTypes(facility.id, locale), plans, prices, adults),
		allTags,
		calendarDays: calendar.days,
		calendarThrough: calendar.through,
		today,
		referenceMode: false,
		params: { checkin: checkin ?? '', nights, adults, tag: tag ?? '' }
	};
};
