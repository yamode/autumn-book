import { pointLedger, memberRanks, expiringPoints, facilities, myReservations, listMyOtayori } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbPointLedger, sumExpiringPoints, getOtayoriMySummary } from '$lib/server/supabase-data';
import { addDays, todayStr } from '$lib/format';
import type { RankCode } from '$lib/plan-access';
import type { PageServerLoad } from './$types';

type RankProgress = {
	rank_code?: RankCode;
	visits: number;
	by_facility: { facility_id: string; name: string; visits: number }[];
	review_on: string | null;
};

export const load: PageServerLoad = async (event) => {
	const { locals } = event;

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		const [ledger, rankResult, otayori] = await Promise.all([
			sbPointLedger(client),
			client.rpc('my_rank_progress'),
			getOtayoriMySummary(client)
		]);
		return {
			ledger,
			ranks: memberRanks,
			expiring: sumExpiringPoints(ledger),
			rankProgress: rankResult.error || typeof rankResult.data?.visits !== 'number'
				? null : rankResult.data as RankProgress,
			otayori: {
				balance: otayori.balance,
				ledger: otayori.ledger.map((e) => ({
					id: e.id,
					delta: e.delta,
					reason: e.reason,
					createdAt: (e.created_at ?? '').slice(0, 10)
				})),
				posts: otayori.posts.map((p) => ({
					id: p.id,
					body: p.body,
					radioName: p.radio_name ?? undefined,
					status: p.status,
					reviewNote: p.review_note ?? undefined,
					createdAt: (p.created_at ?? '').slice(0, 10)
				}))
			}
		};
	}

	const memberId = locals.user!.id;
	const today = todayStr();
	let windowStart = `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
	if (windowStart.endsWith('-02-29')) windowStart = windowStart.slice(0, -2) + '28';
	const stays = myReservations(memberId)
		.filter((booking) => booking.status === 'stayed' && booking.channel === 'autumn_booking' && booking.nights > 0)
		.map((booking) => ({ ...booking, checkout: addDays(booking.checkin, booking.nights) }))
		.filter((booking) => booking.checkout > windowStart && booking.checkout <= today)
		.sort((a, b) => a.checkin.localeCompare(b.checkin));
	const by_facility = facilities.map((facility) => {
		let visits = 0;
		let previousCheckout = '';
		for (const stay of stays) {
			if (stay.facilityId !== facility.id) continue;
			if (stay.checkin > previousCheckout) visits++;
			if (stay.checkout > previousCheckout) previousCheckout = stay.checkout;
		}
		return { facility_id: facility.id, name: facility.name, visits };
	});
	const rankProgress: RankProgress = {
		visits: by_facility.reduce((sum, facility) => sum + facility.visits, 0),
		by_facility,
		review_on: null
	};
	const otayori = listMyOtayori(memberId);
	return {
		ledger: pointLedger.filter((p) => p.memberId === memberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
		ranks: memberRanks,
		expiring: expiringPoints(memberId),
		rankProgress,
		otayori
	};
};
