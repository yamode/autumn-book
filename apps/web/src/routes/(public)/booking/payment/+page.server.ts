import { fail, redirect } from '@sveltejs/kit';
import { getHold, planById, facilityById, roomTypeById, confirmBooking } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import {
	sbGetHoldMapped,
	sbPlanByUuid,
	sbRoomTypeByUuid,
	sbFacilityByUuid,
	confirmBooking as sbConfirmBooking,
	bookingSessionId,
	getBookingDraft,
	clearBookingDraft,
	setLastBooking
} from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { url, cookies } = event;

	if (DATA_SOURCE === 'supabase') {
		const id = url.searchParams.get('id') ?? '';
		const sid = bookingSessionId(cookies);
		const draft = getBookingDraft(cookies);
		const hold = await sbGetHoldMapped(id, sid);
		if (!hold || hold.status !== 'active' || !draft || draft.holdId !== id) {
			return { expired: true as const };
		}
		const [plan, room, facility] = await Promise.all([
			sbPlanByUuid(hold.planId),
			sbRoomTypeByUuid(hold.roomTypeId),
			sbFacilityByUuid(hold.facilityId)
		]);
		if (!plan || !room || !facility) return { expired: true as const };

		const method = draft.payment;
		const discountRate = Math.min(plan.payment.prepayDiscountRate, 0.2); // 実データに事前決済割引は無い（0）
		const discountAmount = Math.round(hold.quote.total * discountRate);
		return {
			expired: false as const,
			hold,
			plan,
			method,
			discountRate,
			discountAmount,
			payableTotal: hold.quote.total - discountAmount - draft.pointsUsed,
			room,
			facility
		};
	}

	const hold = getHold(url.searchParams.get('id') ?? '');
	if (!hold || hold.status !== 'active' || !hold.guestDraft) {
		return { expired: true as const };
	}
	const plan = planById(hold.planId)!;
	const method = hold.paymentDraft ?? 'card';
	const discountRate = Math.min(plan.payment.prepayDiscountRate, 0.2);
	const discountAmount = Math.round(hold.quote.total * discountRate);
	return {
		expired: false as const,
		hold,
		plan,
		method,
		discountRate,
		discountAmount,
		payableTotal: hold.quote.total - discountAmount - hold.quote.pointsUsed,
		room: roomTypeById(hold.roomTypeId)!,
		facility: facilityById(hold.facilityId)!
	};
};

export const actions: Actions = {
	// デモ決済：本実装では Stripe Payment Element + 3DS（カード）/ PayPay（Stripe 経由 or PayPay for Developers）
	// 事前決済は予約時の即時決済（設計書 §15.4 + 2026-06-12 PayPay/割引要件）
	pay: async (event) => {
		const { request, locals, cookies } = event;
		const form = await request.formData();
		const holdId = String(form.get('holdId'));

		if (DATA_SOURCE === 'supabase') {
			const sid = bookingSessionId(cookies);
			const draft = getBookingDraft(cookies);
			const hold = await sbGetHoldMapped(holdId, sid);
			if (!hold || hold.status !== 'active' || !draft || draft.holdId !== holdId) {
				return fail(410, { message: m.error_hold_expired() });
			}
			const useMember = MEMBER_SUPABASE && locals.user?.role === 'member';
			const client = useMember ? createSupabaseServerClient(event) : undefined;
			const pointsUsed = useMember ? draft.pointsUsed : 0;
			const result = await sbConfirmBooking(holdId, sid, draft.guest, { client, pointsUsed, locale: getLocale() });
			if ('error' in result) return fail(410, { message: m.error_confirm_failed() });
			setLastBooking(cookies, {
				code: result.booking_code,
				facilityUuid: hold.facilityId,
				roomUuid: hold.roomTypeId,
				planUuid: hold.planId,
				checkin: hold.checkin,
				nights: hold.nights,
				adults: hold.adults,
				total: result.total,
				pointsUsed: result.points_used,
				pointsEarned: result.points_earned,
				payment: draft.payment,
				discountAmount: result.discount ?? 0,
				guest: draft.guest
			});
			clearBookingDraft(cookies);
			redirect(303, `/booking/complete/${result.booking_code}`);
		}

		const hold = getHold(holdId);
		if (!hold || hold.status !== 'active' || !hold.guestDraft) {
			return fail(410, { message: m.error_hold_expired() });
		}
		const memberId = locals.user?.role === 'member' ? locals.user.id : undefined;
		const result = confirmBooking(hold.id, hold.guestDraft, hold.pointsDraft ?? 0, memberId, hold.paymentDraft ?? 'card');
		if ('error' in result) return fail(410, { message: m.error_confirm_failed() });
		redirect(303, `/booking/complete/${result.code}`);
	}
};
