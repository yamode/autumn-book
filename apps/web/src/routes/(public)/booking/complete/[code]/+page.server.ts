import { error } from '@sveltejs/kit';
import { bookings, facilityById, planById, roomTypeById } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { getLastBooking, sbFacilityByUuid, sbRoomTypeByUuid, sbPlanByUuid } from '$lib/server/supabase-data';
import type { Booking } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies, locals }) => {
	if (DATA_SOURCE === 'supabase') {
		// 確定直後に確定アクションが書いた直近予約 cookie から復元する（anon で booking を再取得する RPC が無いため）。
		const raw = getLastBooking(cookies);
		if (!raw || raw.code !== params.code) error(404, '予約が見つかりません');

		const [facility, room, plan] = await Promise.all([
			sbFacilityByUuid(raw.facilityUuid),
			sbRoomTypeByUuid(raw.roomUuid),
			sbPlanByUuid(raw.planUuid)
		]);
		if (!facility || !room) error(404, '予約が見つかりません');

		const booking: Booking = {
			code: raw.code,
			facilityId: raw.facilityUuid,
			roomTypeId: raw.roomUuid,
			planId: raw.planUuid,
			checkin: raw.checkin,
			nights: raw.nights,
			adults: raw.adults,
			children: 0,
			guest: { name: raw.guest.name, kana: raw.guest.kana, phone: raw.guest.phone, email: raw.guest.email },
			total: raw.total,
			pointsUsed: raw.pointsUsed,
			pointsEarned: raw.pointsEarned,
			payment: raw.payment,
			paymentStatus: raw.payment === 'onsite' ? 'unpaid' : 'paid',
			prepayDiscountRate: raw.prepayDiscountRate,
			discountAmount: raw.discountAmount || undefined,
			status: 'reserved',
			channel: 'autumn_booking',
			cancellationPolicy: plan?.cancellationPolicy ?? { rules: [], note: '' },
			createdAt: new Date().toISOString().slice(0, 10)
		};

		return { booking, facility, plan: plan ?? null, room, isMember: locals.user?.role === 'member' };
	}

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
