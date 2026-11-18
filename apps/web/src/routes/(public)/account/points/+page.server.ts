import { pointLedger, memberRanks, nextPointExpiry, facilities, myReservations } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbPointLedger, sbNextPointExpiry } from '$lib/server/supabase-data';
import { addDays, todayStr } from '$lib/format';
import { nightsBetween } from '@autumn-book/core';
import type { RankCode } from '$lib/plan-access';
import type { PageServerLoad } from './$types';

type RankProgress = {
	rank_code?: RankCode;
	visits: number;
	nights: number;
	by_facility: { facility_id: string; name: string; visits: number; nights: number }[];
};

export const load: PageServerLoad = async (event) => {
	const { locals } = event;

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		const [ledger, rankResult, nextExpiry] = await Promise.all([
			sbPointLedger(client),
			client.schema('book').rpc('my_rank_progress'),
			sbNextPointExpiry(client).catch(() => null)
		]);
		return {
			ledger,
			ranks: memberRanks,
			nextExpiry,
			rankProgress: rankResult.error || !Array.isArray(rankResult.data?.by_facility) ||
				typeof rankResult.data?.nights !== 'number' || !rankResult.data.by_facility.every((facility: { nights?: number }) => typeof facility.nights === 'number')
				? null : rankResult.data as RankProgress
		};
	}

	const memberId = locals.user!.id;
	const today = todayStr();
	const stays = myReservations(memberId)
		.filter((booking) => booking.status === 'stayed' && booking.channel === 'autumn_booking' && booking.nights > 0)
		.map((booking) => ({ ...booking, checkout: addDays(booking.checkin, booking.nights) }))
		.filter((booking) => booking.checkout <= today)
		.sort((a, b) => a.checkin.localeCompare(b.checkin));
	const by_facility = facilities.map((facility) => {
		let visits = 0;
		let nights = 0;
		let previousCheckout = '';
		for (const stay of stays) {
			if (stay.facilityId !== facility.id) continue;
			if (stay.checkin > previousCheckout) visits++;
			if (stay.checkout > previousCheckout) {
				nights += nightsBetween(stay.checkin > previousCheckout ? stay.checkin : previousCheckout, stay.checkout);
				previousCheckout = stay.checkout;
			}
		}
		return { facility_id: facility.id, name: facility.name, visits, nights };
	});
	const rankProgress: RankProgress = {
		visits: by_facility.reduce((sum, facility) => sum + facility.visits, 0),
		nights: by_facility.reduce((sum, facility) => sum + facility.nights, 0),
		by_facility
	};
	return {
		ledger: pointLedger.filter((p) => p.memberId === memberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
		ranks: memberRanks,
		nextExpiry: nextPointExpiry(memberId),
		rankProgress
	};
};
