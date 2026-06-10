import { fail, redirect } from '@sveltejs/kit';
import { getHold, planById, facilityById, roomTypeById, confirmBooking } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const hold = getHold(url.searchParams.get('id') ?? '');
	if (!hold || hold.status !== 'active' || !hold.guestDraft) {
		return { expired: true as const };
	}
	return {
		expired: false as const,
		hold,
		plan: planById(hold.planId)!,
		room: roomTypeById(hold.roomTypeId)!,
		facility: facilityById(hold.facilityId)!
	};
};

export const actions: Actions = {
	// デモ決済：本実装では Stripe Payment Element + PaymentIntent + 3DS（設計書 §15.4）
	pay: async ({ request, locals }) => {
		const form = await request.formData();
		const hold = getHold(String(form.get('holdId')));
		if (!hold || hold.status !== 'active' || !hold.guestDraft) {
			return fail(410, { message: '確保時間が過ぎました。お手数ですが、もう一度お選び直しください。' });
		}
		const memberId = locals.user?.role === 'member' ? locals.user.id : undefined;
		const result = confirmBooking(hold.id, hold.guestDraft, hold.pointsDraft ?? 0, memberId);
		if ('error' in result) return fail(410, { message: '予約を確定できませんでした。もう一度お試しください。' });
		redirect(303, `/booking/complete/${result.code}`);
	}
};
