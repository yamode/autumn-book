// デモ決済画面（DATA_SOURCE=demo のときだけ）。
//
// 実データ（supabase）のカード決済は予約入力画面（/booking/hold）の中で払う（v0.43.0・同じ画面で払う決済部品）。
// この画面は Stripe を呼ばずに予約を確定するデモなので、実データでは使わせず予約入力画面へ戻す
// （v0.42 以前は実データでも事前決済プランがここで「支払わずに」確定していた）。
import { fail, redirect } from '@sveltejs/kit';
import { getHold, planById, facilityById, roomTypeById, confirmBooking } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	if (DATA_SOURCE === 'supabase') {
		redirect(303, `/booking/hold?id=${encodeURIComponent(url.searchParams.get('id') ?? '')}`);
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
	// デモ決済（カード / PayPay の見本）。事前決済は予約時の即時決済（設計書 §15.4 + 2026-06-12 PayPay/割引要件）
	pay: async (event) => {
		const { request, locals } = event;
		if (DATA_SOURCE === 'supabase') return fail(410, { message: m.error_confirm_failed() });
		const form = await request.formData();
		const holdId = String(form.get('holdId'));

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
