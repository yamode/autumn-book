import { myReservations, facilityById, roomTypeById, expiringPoints } from '$lib/server/store';
import { todayStr } from '$lib/format';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const list = myReservations(locals.user!.id).map((b) => ({
		...b,
		facilityName: facilityById(b.facilityId)!.name,
		facilitySlug: `${facilityById(b.facilityId)!.brandSlug}/${facilityById(b.facilityId)!.slug}`,
		roomName: roomTypeById(b.roomTypeId)!.name,
		photo: facilityById(b.facilityId)!.photos[0].url
	}));
	const today = todayStr();
	return {
		upcoming: list.filter((b) => b.status === 'reserved' && b.checkin >= today).sort((a, b) => a.checkin.localeCompare(b.checkin)),
		past: list.filter((b) => b.status !== 'reserved' || b.checkin < today),
		expiring: expiringPoints(locals.user!.id)
	};
};
