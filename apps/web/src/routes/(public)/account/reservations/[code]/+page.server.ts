import { error, fail } from '@sveltejs/kit';
import { bookings, facilityById, planById, roomTypeById, cancelBooking } from '$lib/server/store';
import { cancellationFee, cancellationRate } from '@autumn-book/core';
import { todayStr } from '$lib/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const booking = bookings.get(params.code);
	if (!booking || booking.memberId !== locals.user!.id) error(404, '予約が見つかりません');
	const today = todayStr();
	return {
		booking,
		facility: facilityById(booking.facilityId)!,
		plan: planById(booking.planId)!,
		room: roomTypeById(booking.roomTypeId)!,
		cancelPreview:
			booking.status === 'reserved'
				? {
						fee: cancellationFee(booking.cancellationPolicy, booking.checkin, today, booking.total),
						rate: cancellationRate(booking.cancellationPolicy, booking.checkin, today)
					}
				: null
	};
};

export const actions: Actions = {
	cancel: async ({ params, locals }) => {
		const booking = bookings.get(params.code);
		if (!booking || booking.memberId !== locals.user!.id) return fail(404, { message: '予約が見つかりません' });
		const result = cancelBooking(params.code);
		if ('error' in result) return fail(400, { message: 'この予約はキャンセルできません。' });
		return { cancelled: true };
	}
};
