import { error } from '@sveltejs/kit';
import { bookings, facilityById, planById, roomTypeById } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const booking = bookings.get(params.code);
	if (!booking) error(404, '予約が見つかりません');
	return {
		booking,
		facility: facilityById(booking.facilityId)!,
		plan: planById(booking.planId)!,
		room: roomTypeById(booking.roomTypeId)!,
		isMember: locals.user?.role === 'member'
	};
};
