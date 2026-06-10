import { fail, redirect } from '@sveltejs/kit';
import {
	getHold,
	planById,
	roomTypeById,
	facilityById,
	confirmBooking,
	memberById,
	pointBalance,
	quoteFor,
	memberRanks
} from '$lib/server/store';
import { earnedPoints } from '@autumn-book/core';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const hold = getHold(url.searchParams.get('id') ?? '');
	if (!hold || hold.status !== 'active') {
		return { expired: true as const };
	}
	const member = locals.user?.role === 'member' ? memberById(locals.user.id) : undefined;
	const rank = memberRanks.find((r) => r.code === (member?.rank ?? 'standard'))!;
	return {
		expired: false as const,
		hold,
		plan: planById(hold.planId)!,
		room: roomTypeById(hold.roomTypeId)!,
		facility: facilityById(hold.facilityId)!,
		member: member
			? {
					name: member.name,
					kana: member.kana,
					phone: member.phone,
					email: member.email,
					balance: pointBalance(member.id),
					earn: earnedPoints(hold.quote.total, rank.rewardRate)
				}
			: null
	};
};

export const actions: Actions = {
	submit: async ({ request, locals }) => {
		const form = await request.formData();
		const holdId = String(form.get('holdId'));
		const hold = getHold(holdId);
		if (!hold || hold.status !== 'active') {
			return fail(410, { message: m.error_hold_expired() });
		}

		const guest = {
			name: String(form.get('name') ?? '').trim(),
			kana: String(form.get('kana') ?? '').trim(),
			phone: String(form.get('phone') ?? '').trim(),
			email: String(form.get('email') ?? '').trim(),
			arrival: String(form.get('arrival') ?? ''),
			shuttle: form.get('shuttle') === 'on',
			notes: String(form.get('notes') ?? '').trim()
		};
		const errors: Record<string, string> = {};
		if (!guest.name) errors.name = m.error_name_required();
		if (!guest.kana) errors.kana = m.error_kana_required();
		if (!/^[0-9\-+ ]{10,}$/.test(guest.phone)) errors.phone = m.error_phone_invalid();
		if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guest.email)) errors.email = m.error_email_invalid();
		if (Object.keys(errors).length > 0) return fail(400, { errors, values: guest });

		const memberId = locals.user?.role === 'member' ? locals.user.id : undefined;
		const pointsUsed = memberId ? Math.max(0, Number(form.get('points') ?? 0)) : 0;

		// 支払い方法（プランの決済設定でバリデーション）
		const plan = planById(hold.planId)!;
		const payment = String(form.get('payment') ?? 'onsite') as 'onsite' | 'card' | 'paypay';
		const allowed =
			payment === 'onsite' ? plan.payment.onsite : plan.payment.prepay && plan.payment.prepayMethods.includes(payment);
		if (!allowed) return fail(400, { errors: { payment: 'お支払い方法を選択してください' }, values: guest });

		if (payment !== 'onsite') {
			// ③ 決済ステップへ（事前決済=即時決済。入力内容を hold に保持）
			hold.guestDraft = guest;
			hold.pointsDraft = pointsUsed;
			hold.paymentDraft = payment;
			redirect(303, `/booking/payment?id=${hold.id}`);
		}

		const result = confirmBooking(hold.id, guest, pointsUsed, memberId, 'onsite');
		if ('error' in result) {
			return fail(410, { message: m.error_hold_expired() });
		}
		redirect(303, `/booking/complete/${result.code}`);
	},

	usePoints: async ({ request, locals }) => {
		// ポイント入力の再計算（画面遷移なしの再見積もり相当）
		const form = await request.formData();
		const hold = getHold(String(form.get('holdId')));
		if (!hold || locals.user?.role !== 'member') return fail(400, {});
		const points = Math.min(Math.max(0, Number(form.get('points') ?? 0)), pointBalance(locals.user.id), hold.quote.total);
		hold.quote = quoteFor(hold.planId, hold.roomTypeId, hold.checkin, hold.nights, hold.adults, hold.children, points);
		return { pointsApplied: points };
	}
};
