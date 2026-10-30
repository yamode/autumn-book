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
import { listedSecretPlans, viewerOf } from '$lib/server/secret-plans';
import { listPlanFor } from '$lib/plan-access';
import { crossTypeCombos } from '$lib/partner-room-combos';
import { MAX_ROOMS_PER_BOOKING } from '$lib/multi-room';
import type { RatePlan, RoomType } from '$lib/types';
import type { PageServerLoad } from './$types';

type RoomPlanPrice = {
	ratePlanId: string;
	roomTypeId: string;
	total: number | null;
	referencePrice: number | null;
	remaining: number | null;
};

/**
 * 必要な室数を部屋タイプ横断で満たす組み合わせ（どの部屋タイプも単独では足りないとき。同じプランの部屋タイプを合わせる）。
 * 予約かごに入れて予約へ進む（かごは部屋タイプを混ぜて 1 回で仮押さえできる）。
 */
function combosFor(rooms: RoomType[], plans: RatePlan[], prices: RoomPlanPrice[], adults: number, nights: number, roomCount: number) {
	if (roomCount < 2) return [];
	const planById = new Map(plans.map((plan) => [plan.id, plan]));
	const roomById = new Map(rooms.map((room) => [room.id, room]));
	const offers = prices.flatMap((price) => {
		const plan = planById.get(price.ratePlanId);
		const room = roomById.get(price.roomTypeId);
		if (!plan || !room || price.total === null || price.remaining === null || room.capacity < adults) return [];
		return [
			{
				roomCode: room.id,
				roomName: room.name,
				planCode: plan.id,
				planName: plan.name,
				mealType: null,
				perPerson: Math.round(price.total / (adults * nights)),
				totalPerPerson: price.total / adults,
				remaining: price.remaining
			}
		];
	});
	return crossTypeCombos(offers, roomCount, adults).map((combo) => {
		const plan = planById.get(combo.planCode)!;
		return {
			planId: plan.id,
			planSlug: plan.slug,
			planName: plan.name,
			pay: { onsite: plan.payment.onsite, prepay: plan.payment.prepay },
			total: combo.total,
			parts: combo.parts.map((part) => ({
				roomTypeId: part.roomCode,
				roomName: part.roomName,
				rooms: part.rooms,
				// その部屋 1 室の宿泊料金（全泊・割引前）
				roomTotal: Math.round(part.totalPerPerson * adults),
				remaining: part.remaining
			}))
		};
	});
}

function roomsWithPlans(rooms: RoomType[], plans: RatePlan[], prices: RoomPlanPrice[], adults: number, roomCount = 1) {
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
				// 室数を指定したときは、その室数に残室が足りない部屋タイプ・プランは一覧に出さない（組み合わせは別枠で出す）
				.filter((item) => roomCount < 2 || item.remaining === null || item.remaining >= roomCount)
				.sort((a, b) => (a.total ?? a.referencePrice ?? Infinity) - (b.total ?? b.referencePrice ?? Infinity))
		}))
		.sort((a, b) => Number(b.plans.length > 0) - Number(a.plans.length > 0));
}

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const isMember = viewerIsMember(locals);
	// 会員限定のシークレットプランを一覧に足すかどうか（会員のグレードで決まる。URL 限定は一覧に出さない）
	const viewer = await viewerOf(locals);
	const checkin = url.searchParams.get('checkin') || undefined;
	const nights = Math.min(7, Math.max(1, Number(url.searchParams.get('nights') ?? 1)));
	const adults = Math.min(6, Math.max(1, Number(url.searchParams.get('adults') ?? 2)));
	const roomCount = Math.min(MAX_ROOMS_PER_BOOKING, Math.max(1, Number(url.searchParams.get('rooms') ?? 1) || 1));
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
		// 対象の会員には会員限定プランも出す（列挙系 RPC は普通のプランだけを返すので、プランごとに料金を取る）
		const memberPlans = await listedSecretPlans(facility.id, viewer);
		if (memberPlans.length > 0) {
			const extra = await Promise.all(
				memberPlans.map((plan) =>
					checkin
						? sbPlanOffers(facility.id, checkin, nights, adults, plan.id).then((rows) => ({ offers: rows, refs: [] as typeof referencePrices }))
						: sbRoomPlanReferencePrices(facility.id, adults, plan.id).then((rows) => ({ offers: [] as typeof datedOffers, refs: rows }))
				).map((p) => p.catch(() => ({ offers: [] as typeof datedOffers, refs: [] as typeof referencePrices })))
			);
			allPlans.push(...memberPlans);
			for (const e of extra) {
				datedOffers.push(...e.offers);
				referencePrices.push(...e.refs);
			}
		}
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
			rooms: roomsWithPlans(allRooms, plans, prices, adults, roomCount),
			combos: combosFor(allRooms, plans, prices, adults, nights, roomCount),
			allTags,
			calendarDays: calendar.days,
			calendarThrough: calendar.through,
			calendarClosed: calendar.closed,
			today,
			referenceMode: !checkin,
			params: { checkin: checkin ?? '', nights, adults, rooms: roomCount, tag: tag ?? '' }
		};
	}

	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');
	const allPlans = getRatePlans(facility.id, locale).filter((plan) => listPlanFor(plan.access, viewer));
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
		rooms: roomsWithPlans(getRoomTypes(facility.id, locale), plans, prices, adults, roomCount),
		combos: combosFor(getRoomTypes(facility.id, locale), plans, prices, adults, nights, roomCount),
		allTags,
		calendarDays: calendar.days,
		calendarThrough: calendar.through,
			calendarClosed: calendar.closed,
		today,
		referenceMode: false,
		params: { checkin: checkin ?? '', nights, adults, rooms: roomCount, tag: tag ?? '' }
	};
};
