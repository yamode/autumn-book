import { myReservations, facilityById, roomTypeById, expiringPoints } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbMyReservations, sbPointLedger, sumExpiringPoints, reverseFacilityUuid } from '$lib/server/supabase-data';
import { todayStr } from '$lib/format';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { locals } = event;
	const today = todayStr();

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		const [reservations, ledger] = await Promise.all([sbMyReservations(client), sbPointLedger(client)]);
		const list = reservations.map((r) => {
			// 施設マスタ（名称・写真・スラッグ）は store 側が正。実 UUID から逆引きする。
			const storeId = reverseFacilityUuid(r.facilityUuid);
			const f = storeId ? facilityById(storeId) : undefined;
			return {
				code: r.code,
				status: r.status,
				channel: r.channel,
				checkin: r.checkin,
				nights: r.nights,
				adults: r.adults,
				total: r.total,
				pointsUsed: r.pointsUsed,
				payment: r.payment,
				facilityName: f?.name ?? '—',
				facilitySlug: f ? `${f.brandSlug}/${f.slug}` : '',
				// 客室マスタ（room_type_id UUID）は公開コンテンツ未投入のため未解決（空表示）。
				roomName: '',
				photo: f?.photos[0]?.url ?? ''
			};
		});
		return {
			upcoming: list.filter((b) => b.status === 'reserved' && b.checkin >= today).sort((a, b) => a.checkin.localeCompare(b.checkin)),
			past: list.filter((b) => b.status !== 'reserved' || b.checkin < today),
			expiring: sumExpiringPoints(ledger)
		};
	}

	const list = myReservations(locals.user!.id).map((b) => ({
		...b,
		facilityName: facilityById(b.facilityId)!.name,
		facilitySlug: `${facilityById(b.facilityId)!.brandSlug}/${facilityById(b.facilityId)!.slug}`,
		roomName: roomTypeById(b.roomTypeId)!.name,
		photo: facilityById(b.facilityId)!.photos[0].url
	}));
	return {
		upcoming: list.filter((b) => b.status === 'reserved' && b.checkin >= today).sort((a, b) => a.checkin.localeCompare(b.checkin)),
		past: list.filter((b) => b.status !== 'reserved' || b.checkin < today),
		expiring: expiringPoints(locals.user!.id)
	};
};
