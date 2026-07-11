import { error, fail } from '@sveltejs/kit';
import {
	bookings,
	facilityById,
	planById,
	roomTypeById,
	cancelBooking,
	listMyBookingOptions,
	cancelBookingOption,
	listMyAmendments
} from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import {
	sbMyReservations,
	sbCancelBookingAsMember,
	sbListMyBookingOptions,
	sbCancelBookingOption,
	sbListMyAmendments,
	reverseFacilityUuid
} from '$lib/server/supabase-data';
import { cancellationFee, cancellationRate, addDays } from '@autumn-book/core';
import { todayStr } from '$lib/format';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

// 変更可否ゲート（会員 & reserved & 締切前 & 残回数あり）。
// 締切 = チェックイン日 9:00 施設TZ（≒ JST）。9:00 JST = 当日 00:00 UTC。上限2回。
function amendGate(status: string, checkin: string, amendCount: number) {
	const deadlinePassed = Date.now() >= Date.parse(checkin + 'T00:00:00Z');
	const remaining = Math.max(0, 2 - amendCount);
	return {
		remaining,
		deadlinePassed,
		canAmend: status === 'reserved' && !deadlinePassed && remaining > 0
	};
}

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
		// 滞在アレンジ（オプション）明細。締切表示用に checkout（提供日セレクトの上限）も返す。
		const options = await sbListMyBookingOptions(createSupabaseServerClient(event), r.code);
		// 変更履歴・変更可否
		const amendments = await sbListMyAmendments(client, r.code);
		return {
			booking,
			facility,
			checkout: r.checkout,
			options,
			amendments,
			amend: amendGate(r.status, r.checkin, amendments.length),
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
	const options = listMyBookingOptions(params.code, locals.user!.id);
	const amendments = listMyAmendments(params.code, locals.user!.id);
	return {
		booking,
		facility: facilityById(booking.facilityId)!,
		checkout: addDays(booking.checkin, booking.nights),
		options,
		amendments,
		amend: amendGate(booking.status, booking.checkin, amendments.length),
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
	},

	// オプション（滞在アレンジ）明細の取消（本人・提供日前日まで）
	cancelOption: async (event) => {
		const { request, params, locals } = event;
		const form = await request.formData();
		const orderId = String(form.get('orderId') ?? '');
		if (!orderId) return fail(400, { message: m.options_cancel_failed() });

		if (MEMBER_SUPABASE) {
			try {
				await sbCancelBookingOption(createSupabaseServerClient(event), orderId);
			} catch {
				return fail(400, { message: m.options_cancel_failed() });
			}
			return { optionCancelled: true };
		}

		const booking = bookings.get(params.code);
		if (!booking || booking.memberId !== locals.user!.id) return fail(404, { message: m.error_booking_not_found() });
		try {
			cancelBookingOption(orderId, locals.user!.id);
		} catch {
			return fail(400, { message: m.options_cancel_failed() });
		}
		return { optionCancelled: true };
	}
};
