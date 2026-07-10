import { pointLedger, memberRanks, expiringPoints, myReservations } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbPointLedger, sbMyReservations, sumExpiringPoints } from '$lib/server/supabase-data';
import { todayStr } from '$lib/format';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { locals } = event;
	const yearStart = todayStr().slice(0, 4) + '-01-01';

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		const [ledger, reservations] = await Promise.all([sbPointLedger(client), sbMyReservations(client)]);
		const staysThisYear = reservations
			.filter((b) => b.status !== 'cancelled' && b.checkin >= yearStart)
			.reduce((s, b) => s + b.nights, 0);
		return {
			ledger,
			ranks: memberRanks,
			expiring: sumExpiringPoints(ledger),
			staysThisYear
		};
	}

	const memberId = locals.user!.id;
	// 年間宿泊数（ランク進捗用・デモは予約データから算出）
	const staysThisYear = myReservations(memberId)
		.filter((b) => b.status !== 'cancelled' && b.checkin >= yearStart)
		.reduce((s, b) => s + b.nights, 0);
	return {
		ledger: pointLedger.filter((p) => p.memberId === memberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
		ranks: memberRanks,
		expiring: expiringPoints(memberId),
		staysThisYear
	};
};
