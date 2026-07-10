import { error, fail } from '@sveltejs/kit';
import { bookings, facilityById, planById, roomTypeById, cancelBooking } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbMyReservations, sbCancelBookingAsMember, reverseFacilityUuid } from '$lib/server/supabase-data';
import { cancellationFee, cancellationRate } from '@autumn-book/core';
import { todayStr } from '$lib/format';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { params, locals } = event;
	const today = todayStr();

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		const reservations = await sbMyReservations(client);
		const r = reservations.find((x) => x.code === params.code);
		if (!r) error(404, m.error_booking_not_found());
		const storeId = reverseFacilityUuid(r.facilityUuid);
		const facility = storeId ? facilityById(storeId) : undefined;
		if (!facility) error(404, m.error_booking_not_found());
		const booking = {
			code: r.code,
			status: r.status,
			channel: r.channel,
			checkin: r.checkin,
			nights: r.nights,
			adults: r.adults,
			guest: r.guest,
			total: r.total,
			pointsUsed: r.pointsUsed,
			pointsEarned: r.pointsEarned,
			payment: r.payment,
			paymentStatus: r.paymentStatus,
			cancelFee: r.cancelFee,
			cancellationPolicy: r.cancellationPolicy
		};
		return {
			booking,
			facility,
			// プラン/客室マスタ（rate_plan_id / room_type_id UUID）は公開コンテンツ未投入のため名称未解決
			plan: { name: '', cancellationPolicy: r.cancellationPolicy },
			room: { name: '' },
			cancelPreview:
				r.status === 'reserved'
					? {
							fee: cancellationFee(r.cancellationPolicy, r.checkin, today, r.total),
							rate: cancellationRate(r.cancellationPolicy, r.checkin, today)
						}
					: null
		};
	}

	const booking = bookings.get(params.code);
	if (!booking || booking.memberId !== locals.user!.id) error(404, m.error_booking_not_found());
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
	cancel: async (event) => {
		const { params, locals } = event;

		if (MEMBER_SUPABASE) {
			try {
				// 所有者チェック・キャンセル料・ポイント巻き戻しは cancel_booking RPC が実施
				await sbCancelBookingAsMember(createSupabaseServerClient(event), params.code);
			} catch {
				return fail(400, { message: m.error_cannot_cancel() });
			}
			return { cancelled: true };
		}

		const booking = bookings.get(params.code);
		if (!booking || booking.memberId !== locals.user!.id) return fail(404, { message: m.error_booking_not_found() });
		const result = cancelBooking(params.code);
		if ('error' in result) return fail(400, { message: m.error_cannot_cancel() });
		return { cancelled: true };
	}
};
