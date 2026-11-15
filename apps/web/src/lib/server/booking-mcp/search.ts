import { listPlanFor, type PlanViewer } from '$lib/plan-access';
import { listedSecretPlans } from '$lib/server/secret-plans';
import { STAY_FACILITIES, todayJst } from '$lib/server/stay-calendar';
import { sbFacilityBySlug, sbListPlansMapped, sbListRoomTypesMapped, sbPlanOffers } from '$lib/server/supabase-data';

type FacilitySlug = (typeof STAY_FACILITIES)[number];

export interface BookingSearch {
	facility: FacilitySlug | 'both';
	checkin: string;
	nights: number;
	adults: number;
}

const DAY_MS = 86400000;

export function validCheckin(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(value);
	const daysFromToday = (date.getTime() - Date.parse(todayJst())) / DAY_MS;
	return daysFromToday >= 0 && daysFromToday <= 366 && date.toISOString().slice(0, 10) === value;
}

async function facilityOffers(origin: string, slug: FacilitySlug, query: BookingSearch, viewer: PlanViewer) {
	const facility = await sbFacilityBySlug(slug);
	if (!facility || facility.brandSlug !== 'yamado') throw new Error('YAMADO facility is unavailable');
	const { checkin, nights, adults } = query;
	const [openPlans, rooms, offers, memberPlans] = await Promise.all([
		sbListPlansMapped(facility.id),
		sbListRoomTypesMapped(facility.id),
		sbPlanOffers(facility.id, checkin, nights, adults),
		listedSecretPlans(facility.id, viewer)
	]);
	const memberOffers = await Promise.all(memberPlans.map((plan) => sbPlanOffers(facility.id, checkin, nights, adults, plan.id)));
	const plans = new Map([...openPlans, ...memberPlans].filter((plan) => listPlanFor(plan.access, viewer)).map((plan) => [plan.id, plan]));
	const roomTypes = new Map(rooms.map((room) => [room.id, room]));
	const available = [...offers, ...memberOffers.flat()].flatMap((offer) => {
		const plan = plans.get(offer.ratePlanId);
		const room = roomTypes.get(offer.roomTypeId);
		if (!plan || !room || offer.remaining < 1) return [];

		const detail = new URL(`/yamado/${slug}/plans/${encodeURIComponent(plan.slug || plan.id)}`, origin);
		detail.search = new URLSearchParams({ checkin, nights: String(nights), adults: String(adults), room: room.slug, utm_source: 'claude', utm_medium: 'ai' }).toString();
		const login = new URL('/auth/login', origin);
		login.searchParams.set('next', detail.pathname + detail.search);
		return [{
			plan: plan.name,
			room: room.name,
			roomAmenities: room.amenities,
			accommodationEstimateJpy: offer.total,
			bookingUrl: login.href
		}];
	});
	available.sort((a, b) => a.accommodationEstimateJpy - b.accommodationEstimateJpy);
	return { facility: slug, name: facility.name, availableCount: available.length, offers: available.slice(0, 8) };
}

export async function searchBookingOffers(origin: string, query: BookingSearch, viewer: PlanViewer) {
	const facilities = query.facility === 'both' ? STAY_FACILITIES : [query.facility];
	return {
		checkin: query.checkin,
		nights: query.nights,
		adults: query.adults,
		rooms: 1,
		facilities: await Promise.all(facilities.map((slug) => facilityOffers(origin, slug, query, viewer))),
		note: '表示は指定人数・全泊分の宿泊料金の見積もりです。空室・金額は変動します。入湯税、追加料金、割引、取消条件、最終金額は山人Bookでご確認ください。予約や仮押さえは行っていません。'
	};
}
