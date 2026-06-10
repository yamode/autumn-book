import { pointLedger, memberRanks, expiringPoints, myReservations } from '$lib/server/store';
import { todayStr } from '$lib/format';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const memberId = locals.user!.id;
	// 年間宿泊数（ランク進捗用・デモは予約データから算出）
	const yearStart = todayStr().slice(0, 4) + '-01-01';
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
