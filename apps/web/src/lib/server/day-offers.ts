// 空室カレンダーで日を押したときに出す「その日に予約できる部屋×プラン」（安い順）。
import { eachNight } from '@autumn-book/core';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbListPlansMapped, sbListRoomTypesMapped, sbPlanOffers } from '$lib/server/supabase-data';
import { getRatePlans, getRoomTypes, quoteFor, remainingRooms } from '$lib/server/store';
import { demoPairs } from '$lib/server/stay-calendar';
import type { Locale } from '$lib/types';

export type DayOffer = {
	room: { id: string; slug: string; name: string };
	plan: { id: string; slug: string; name: string; mealPlan: string };
	total: number;
	perPersonNight: number;
	remaining: number;
};

type OfferRow = { ratePlanId: string; roomTypeId: string; total: number; remaining: number };
type PlanInfo = { id: string; slug: string; name: string; mealPlan: string; highlightTags: string[] };
type RoomInfo = { id: string; slug: string; name: string };

export async function dayOffers(
	facilityId: string,
	checkin: string,
	nights: number,
	adults: number,
	options: { roomTypeId?: string; tag?: string; locale: Locale }
): Promise<DayOffer[]> {
	let rows: OfferRow[];
	let plans: PlanInfo[];
	let rooms: RoomInfo[];
	if (DATA_SOURCE === 'supabase') {
		[rows, plans, rooms] = await Promise.all([
			sbPlanOffers(facilityId, checkin, nights, adults),
			sbListPlansMapped(facilityId),
			sbListRoomTypesMapped(facilityId)
		]);
	} else {
		plans = getRatePlans(facilityId, options.locale);
		rooms = getRoomTypes(facilityId, options.locale);
		rows = demoPairs(facilityId, adults).map((pair) => ({
			ratePlanId: pair.planId,
			roomTypeId: pair.roomTypeId,
			remaining: Math.min(...eachNight(checkin, nights).map((night) => remainingRooms(pair.roomTypeId, night))),
			total: quoteFor(pair.planId, pair.roomTypeId, checkin, nights, adults, 0).total
		}));
	}
	const planById = new Map(plans.map((plan) => [plan.id, plan]));
	const roomById = new Map(rooms.map((room) => [room.id, room]));
	const offers: DayOffer[] = [];
	for (const row of rows) {
		const plan = planById.get(row.ratePlanId);
		const room = roomById.get(row.roomTypeId);
		if (!plan || !room || row.remaining <= 0) continue;
		if (options.roomTypeId && room.id !== options.roomTypeId) continue;
		if (options.tag && !plan.highlightTags.includes(options.tag)) continue;
		offers.push({
			room: { id: room.id, slug: room.slug, name: room.name },
			plan: { id: plan.id, slug: plan.slug, name: plan.name, mealPlan: plan.mealPlan },
			total: row.total,
			perPersonNight: Math.round(row.total / (adults * nights)),
			remaining: row.remaining
		});
	}
	return offers.sort((a, b) => a.total - b.total);
}
