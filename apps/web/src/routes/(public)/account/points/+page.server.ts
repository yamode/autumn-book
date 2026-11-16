import { pointLedger, memberRanks, expiringPoints, myReservations, listMyOtayori } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbPointLedger, sumExpiringPoints, getOtayoriMySummary } from '$lib/server/supabase-data';
import { addDays, todayStr } from '$lib/format';
import type { RankCode } from '$lib/plan-access';
import type { PageServerLoad } from './$types';

type RankProgress = { rank_code?: RankCode; nights: number; review_on: string | null };

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
			rankProgress: rankResult.error ? null : rankResult.data as RankProgress | null,
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
	const eligibleNights = new Set<string>();
	for (const booking of myReservations(memberId)) {
		if (booking.status !== 'stayed' || addDays(booking.checkin, booking.nights) > today) continue;
		for (let index = 0; index < booking.nights; index++) {
			const night = addDays(booking.checkin, index);
			if (night >= windowStart) eligibleNights.add(night);
		}
	}
	const rankProgress: RankProgress = { nights: eligibleNights.size, review_on: null };
	const otayori = listMyOtayori(memberId);
	return {
		ledger: pointLedger.filter((p) => p.memberId === memberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
		ranks: memberRanks,
		expiring: expiringPoints(memberId),
		rankProgress,
		otayori
	};
};
