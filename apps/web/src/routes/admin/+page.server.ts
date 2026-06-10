import { bookings, holds, expireHolds, auditLogs } from '$lib/server/store';
import { todayStr, addDays } from '$lib/format';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { currentFacility } = await parent();
	expireHolds();
	const today = todayStr();
	const all = [...bookings.values()].filter((b) => b.facilityId === currentFacility.id);

	const last30 = addDays(today, -30);
	const recent = all.filter((b) => b.createdAt >= last30 && b.channel === 'autumn_booking');

	return {
		todayCheckins: all.filter((b) => b.checkin === today && b.status === 'reserved').length,
		newToday: all.filter((b) => b.createdAt === today && b.status === 'reserved').length,
		cancelledToday: all.filter((b) => b.status === 'cancelled').length,
		activeHolds: [...holds.values()].filter((h) => h.status === 'active' && h.facilityId === currentFacility.id).length,
		recentCount: recent.length,
		recentTotal: recent.reduce((s, b) => s + (b.status === 'cancelled' ? 0 : b.total), 0),
		upcoming: all
			.filter((b) => b.status === 'reserved' && b.checkin >= today)
			.sort((a, b) => a.checkin.localeCompare(b.checkin))
			.slice(0, 5),
		alerts: [
			// 本実装: sync_logs（SC在庫通知失敗）・決済不一致・メール送信失敗を表示（設計書 A-01）
			...auditLogs.slice(0, 3).map((l) => ({ level: 'info' as const, text: `${l.action}: ${l.detail}` }))
		]
	};
};
