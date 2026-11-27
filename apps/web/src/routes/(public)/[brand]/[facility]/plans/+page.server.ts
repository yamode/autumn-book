import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { getFacilityBySlug, getRatePlans, getRoomTypes, remainingRooms, quoteFor } from '$lib/server/store';
import { todayJst } from '$lib/server/stay-calendar';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityBySlug, sbListPlansMapped, sbListRoomTypesMapped, sbPlanOffers, sbRoomPlanReferencePrices } from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import { eachNight } from '@autumn-book/core';
import { loadEarlyPrepaySettings } from '$lib/server/payment-settings';
import { viewerIsMember, withEarlyPrepayMax } from '$lib/server/direct-payments';
import { planForViewer } from '$lib/member-payment';
import { listedSecretPlans, viewerOf } from '$lib/server/secret-plans';
import { listPlanFor } from '$lib/plan-access';
import { crossTypeCombos } from '$lib/partner-room-combos';
import { MAX_ROOMS_PER_BOOKING } from '$lib/multi-room';
import type { RatePlan, RoomType } from '$lib/types';
import { matchesMeal, mealOptions } from '$lib/meal-filter';
import { favoriteRoomTypeIds } from '$lib/server/favorites';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { alertConditions, validateAlertConditions } from '$lib/availability-alerts';
import { alertErrorMessage } from '$lib/server/availability-alert-errors';
import { privateBookFacility, privateBookOffers, privateBookReferencePrices, pbFacilityView } from '$lib/server/private-book';
import { mergePbOffers, PB_PRICE_DEPENDENCY } from '$lib/private-book';
import type { Actions, PageServerLoad } from './$types';
import type { PrivateBookState } from '$lib/private-book';

type PlanRateEvent = RequestEvent<{ brand: string; facility: string }>;

type RoomPlanPrice = {
	ratePlanId: string;
	roomTypeId: string;
	total: number | null;
	referencePrice: number | null;
	remaining: number | null;
	/** プライベートブックの特別料金（専用ページの料金ルール）で出しているか */
	special?: boolean;
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
					return plan ? { plan, total: price.total, referencePrice: price.referencePrice, remaining: price.remaining, special: price.special === true } : null;
				})
				.filter((item): item is NonNullable<typeof item> => item !== null)
				// 室数を指定したときは、その室数に残室が足りない部屋タイプ・プランは一覧に出さない（組み合わせは別枠で出す）
				.filter((item) => roomCount < 2 || item.remaining === null || item.remaining >= roomCount)
				.sort((a, b) => (a.total ?? a.referencePrice ?? Infinity) - (b.total ?? b.referencePrice ?? Infinity))
		}))
		.sort((a, b) => Number(b.plans.length > 0) - Number(a.plans.length > 0));
}

export const load: PageServerLoad = (event) => {
	event.depends(PB_PRICE_DEPENDENCY);
	if (event.locals.privateBook) event.setHeaders({ 'cache-control': 'private, no-store' });
	return _loadPlanRates(event, event.locals.privateBook ?? null);
};

export async function _loadPlanRates(event: PlanRateEvent, pbState: PrivateBookState | null) {
	const { params, url, locals } = event;
	// 会員のお気に入りの部屋がある部屋タイプ（ブロックに「お気に入り」と出す）。会員でなければ空
	const favoritesP = favoriteRoomTypeIds(event);
	const isMember = viewerIsMember(locals);
	// 会員限定のシークレットプランを一覧に足すかどうか（会員のグレードで決まる。URL 限定は一覧に出さない）
	const viewer = viewerOf(locals);
	const checkin = url.searchParams.get('checkin') || undefined;
	const nights = Math.min(7, Math.max(1, Number(url.searchParams.get('nights') ?? 1)));
	const adults = Math.min(6, Math.max(1, Number(url.searchParams.get('adults') ?? 2)));
	const roomCount = Math.min(MAX_ROOMS_PER_BOOKING, Math.max(1, Number(url.searchParams.get('rooms') ?? 1) || 1));
	// お食事で絞り込む（?meal=half:スタンダードコース / breakfast / none 等・lib/meal-filter.ts）
	const meal = url.searchParams.get('meal') || undefined;
	const today = todayJst();

	if (DATA_SOURCE === 'supabase') {
		const facility = await sbFacilityBySlug(params.facility);
		if (!facility || facility.brandSlug !== params.brand) error(404, m.error_facility_not_found());
		// 空室カレンダーは開いたときに /api/stay-calendar で取る（ここでは取らない。使っていなかったうえ、
		// 計算が初回だけ遅く anon の 3 秒の上限で打ち切られ、ページ全体が 500 になっていた・2026-11-19）
		// プライベートブックの状態なら、この施設を特別料金で出すか（施設ごと・docs/private-book.md）。料金の表示は保存させない
		const privateFacility = privateBookFacility(pbState, facility.id);
		const privateOffers = checkin
			? privateFacility.then((fac) => privateBookOffers(fac, facility.id, checkin, nights, adults))
			: Promise.resolve([]);
		const privateRefs = checkin
			? Promise.resolve([])
			: privateFacility.then((fac) => privateBookReferencePrices(fac, facility.id, adults));
		// 会員限定プランの料金も、通常プランや専用料金の取得と並行して進める。
		const memberResults = viewer.then(async (currentViewer) => {
			const plans = await listedSecretPlans(facility.id, currentViewer);
			const prices = await Promise.all(plans.map((plan) => checkin
				? sbPlanOffers(facility.id, checkin, nights, adults, plan.id).then((offers) => ({ offers, refs: [] })).catch(() => ({ offers: [], refs: [] }))
				: sbRoomPlanReferencePrices(facility.id, adults, plan.id).then((refs) => ({ offers: [], refs })).catch(() => ({ offers: [], refs: [] }))
			));
			return { plans, prices };
		});
		const [publicPlans, allRooms, settings, publicOffers, publicRefs, pbFac, specialOffers, specialRefs, member] = await Promise.all([
			sbListPlansMapped(facility.id),
			sbListRoomTypesMapped(facility.id),
			loadEarlyPrepaySettings(facility.id),
			checkin ? sbPlanOffers(facility.id, checkin, nights, adults) : Promise.resolve([]),
			checkin ? Promise.resolve([]) : sbRoomPlanReferencePrices(facility.id, adults),
			privateFacility,
			privateOffers,
			privateRefs,
			memberResults
		]);
		const allPlans = [...publicPlans, ...member.plans];
		const datedOffers = [...publicOffers, ...member.prices.flatMap((price) => price.offers)];
		const referencePrices = [...publicRefs, ...member.prices.flatMap((price) => price.refs)];
		const meals = mealOptions(allPlans);
		const plans = withEarlyPrepayMax(
			allPlans.filter((plan) => matchesMeal(plan, meal)).map((plan) => planForViewer(plan, isMember)),
			settings
		);
		// 特別料金を出せる組は差し替える（出せない組・対象外のプランはふつうの料金のまま）
		const specialKeys = new Set<string>();
		let offers = datedOffers;
		let refs = referencePrices;
		if (pbFac?.special && checkin) {
			const merged = mergePbOffers(datedOffers, specialOffers);
			offers = merged.offers;
			for (const k of merged.specialKeys) specialKeys.add(k);
		} else if (pbFac?.special) {
			const byKey = new Map(specialRefs.map((r) => [`${r.ratePlanId}|${r.roomTypeId}`, r]));
			refs = [...referencePrices.filter((r) => !byKey.has(`${r.ratePlanId}|${r.roomTypeId}`)), ...specialRefs];
			for (const k of byKey.keys()) specialKeys.add(k);
		}
		const isSpecial = (p: { ratePlanId: string; roomTypeId: string }) => specialKeys.has(`${p.ratePlanId}|${p.roomTypeId}`);
		const prices: RoomPlanPrice[] = checkin
			? offers.map((offer) => ({ ratePlanId: offer.ratePlanId, roomTypeId: offer.roomTypeId, total: offer.total, referencePrice: null, remaining: offer.remaining, special: isSpecial(offer) }))
			: refs.map((price) => ({ ratePlanId: price.ratePlanId, roomTypeId: price.roomTypeId, total: null, referencePrice: price.minPerPerson, remaining: null, special: isSpecial(price) }));
		return {
			facility,
			rooms: roomsWithPlans(allRooms, plans, prices, adults, roomCount),
			combos: combosFor(allRooms, plans, prices, adults, nights, roomCount),
			specialCombos: pbFac?.special && roomCount > 1
				? combosFor(allRooms, plans, prices.filter((price) => price.special), adults, nights, roomCount)
				: [],
			meals,
			today,
			referenceMode: !checkin,
			favoriteRoomTypeIds: await favoritesP,
			// プライベートブックの状態のとき、この施設が特別料金か（null＝状態でない）
			privateBook: pbFacilityView(pbState, pbFac),
			privateBookPartnerId: pbState?.partnerId ?? null,
			params: { checkin: checkin ?? '', nights, adults, rooms: roomCount, meal: meal ?? '' }
		};
	}

	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, m.error_facility_not_found());
	const demoViewer = await viewer;
	const allPlans = getRatePlans(facility.id, locale).filter((plan) => listPlanFor(plan.access, demoViewer));
	const meals = mealOptions(allPlans);
	const plans = withEarlyPrepayMax(
		allPlans.filter((plan) => matchesMeal(plan, meal)).map((plan) => planForViewer(plan, isMember)),
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
	return {
		facility,
		rooms: roomsWithPlans(getRoomTypes(facility.id, locale), plans, prices, adults, roomCount),
		combos: combosFor(getRoomTypes(facility.id, locale), plans, prices, adults, nights, roomCount),
		meals,
		today,
		referenceMode: false,
		favoriteRoomTypeIds: await favoritesP,
		specialCombos: [],
		privateBook: null as { special: boolean } | null,
		privateBookPartnerId: null as string | null,
		params: { checkin: checkin ?? '', nights, adults, rooms: roomCount, meal: meal ?? '' }
	};
};

export const actions: Actions = {
	registerAlert: async (event) => {
		if (event.locals.user?.role !== 'member') redirect(303, '/auth/login?next=' + encodeURIComponent(event.url.pathname));
		if (!MEMBER_SUPABASE) return fail(400, { alertError: m.plans_alert_unavailable_env() });
		const form = await event.request.formData();
		const value = alertConditions(form);
		const invalid = validateAlertConditions(value);
		if (invalid || !value.room || form.get('consent') !== 'yes') {
			return fail(400, { alertError: invalid ?? m.plans_alert_check_consent(), alertRoom: value.room });
		}
		const { error } = await createSupabaseServerClient(event).schema('book').rpc('register_room_availability_alert', {
			p_facility_id: value.facility, p_checkin: value.checkin, p_nights: value.nights,
			p_adults: value.adults, p_room_count: value.rooms, p_room_type_id: value.room, p_consent: true
		});
		if (error) return fail(400, { alertError: alertErrorMessage(error.message), alertRoom: value.room });
		return { alertSaved: true, alertRoom: value.room };
	}
};
