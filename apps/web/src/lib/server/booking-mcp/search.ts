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

async function facilityOffers(origin: string, slug: FacilitySlug, query: BookingSearch, viewer: PlanViewer, pilot: boolean) {
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
	const remainingByRoomType = new Map<string, number>();
	const available = [...offers, ...memberOffers.flat()].flatMap((offer) => {
		const plan = plans.get(offer.ratePlanId);
		const room = roomTypes.get(offer.roomTypeId);
		if (!plan || !room || offer.remaining < 1) return [];
		// Different plans for the same room type draw from the same inventory.
		remainingByRoomType.set(room.id, Math.max(remainingByRoomType.get(room.id) ?? 0, offer.remaining));

		const detail = new URL(`/yamado/${slug}/plans/${encodeURIComponent(plan.slug || plan.id)}`, origin);
		detail.search = new URLSearchParams({ checkin, nights: String(nights), adults: String(adults), room: room.slug, utm_source: 'claude', utm_medium: 'ai' }).toString();
		const login = new URL('/auth/login', origin);
		login.searchParams.set('next', detail.pathname + detail.search);
		return [{
			plan: plan.name,
			room: room.name,
			roomAmenities: room.amenities,
			accommodationEstimateJpy: offer.total,
			bookingUrl: login.href,
			...(pilot ? {
				onsiteReviewAvailable: plan.payment.onsite,
				...(plan.payment.onsite ? { planId: plan.id, roomId: room.id } : {})
			} : {})
		}];
	});
	available.sort((a, b) => a.accommodationEstimateJpy - b.accommodationEstimateJpy);
	const availableRoomCount = [...remainingByRoomType.values()].reduce((sum, remaining) => sum + remaining, 0);
	return { facility: slug, name: facility.name, availableRoomCount, offers: available.slice(0, 8), ...(pilot ? { id: facility.id } : {}) };
}

export async function searchBookingOffers(origin: string, query: BookingSearch, viewer: PlanViewer, pilot = false) {
	const facilities = query.facility === 'both' ? STAY_FACILITIES : [query.facility];
	return {
		checkin: query.checkin,
		nights: query.nights,
		adults: query.adults,
		rooms: 1,
		facilities: await Promise.all(facilities.map((slug) => facilityOffers(origin, slug, query, viewer, pilot))),
		note: 'availableRoomCount は指定条件で予約可能な残室数です。offers は料金順のプラン候補（最大8件）で、同じ客室タイプが複数含まれます。料金は指定人数・全泊分の宿泊料金の見積もりです。空室・金額は変動します。入湯税、追加料金、割引、取消条件、最終金額は山人Bookでご確認ください。予約や仮押さえは行っていません。'
			+ (pilot ? ' 利用者が現地払いの候補を選んだら、同じ検索条件で prepare_onsite_booking を呼んでください。事前決済やBookでの手続きが必要な場合は bookingUrl を案内してください。' : '')
	};
}
