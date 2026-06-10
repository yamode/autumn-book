import { fail, redirect } from '@sveltejs/kit';
import { getHold, planById, facilityById, roomTypeById, confirmBooking } from '$lib/server/store';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
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
	pay: async ({ request, locals }) => {
		const form = await request.formData();
		const hold = getHold(String(form.get('holdId')));
		if (!hold || hold.status !== 'active' || !hold.guestDraft) {
			return fail(410, { message: m.error_hold_expired() });
		}
		const memberId = locals.user?.role === 'member' ? locals.user.id : undefined;
		const result = confirmBooking(hold.id, hold.guestDraft, hold.pointsDraft ?? 0, memberId, hold.paymentDraft ?? 'card');
		if ('error' in result) return fail(410, { message: m.error_confirm_failed() });
		redirect(303, `/booking/complete/${result.code}`);
	}
};
