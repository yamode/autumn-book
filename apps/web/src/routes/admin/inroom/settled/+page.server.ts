import { fail } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import {
	listSettledPaymentsDemo,
	refundInroomPaymentDemo,
	refundInroomPayment,
	sbListSettledPayments,
	type SettledInroomPayment
} from '$lib/server/inroom-refund';
import type { Actions, PageServerLoad } from './$types';

// 客室案内の「精算済み・返金」（2026-10-18 指示「客室精算が終わったお客様を Book の管理画面から確認できるように。
// そこから一部返金や全額返金の処理もできるように」）。期間（入金の日・日本時間）で、オンライン決済で精算したお客様と
// 返金の履歴を出し、1件ずつ返金（既定は全額・減らすと一部返金）できる。返金はフロント（共有ID のスタッフ）もできる
// （PMS の Square 返金と同じ）。施設の権限は DB の RPC（has_facility_access）で確かめる。
const useSupabaseAdmin = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';

const DAY = 86400000;
const jstDay = (offsetDays = 0) => new Date(Date.now() + 9 * 3600000 - offsetDays * DAY).toISOString().slice(0, 10);
const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const q = event.url.searchParams;
	let from = isDay(q.get('from')) ? q.get('from')! : jstDay(30);
	let to = isDay(q.get('to')) ? q.get('to')! : jstDay(0);
	if (from > to) [from, to] = [to, from];

	let payments: SettledInroomPayment[] = [];
	let loadError: string | null = null;
	if (useSupabaseAdmin) {
		try {
			payments = await sbListSettledPayments(createSupabaseServerClient(event), currentFacility.id, from, to);
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
	} else {
		payments = listSettledPaymentsDemo(currentFacility.id, from, to);
	}
	const user = event.locals.user;
	return {
		from,
		to,
		today: jstDay(0),
		payments,
		loadError,
		live: useSupabaseAdmin,
		canRefund: user?.role === 'admin' || user?.role === 'staff'
	};
};

export const actions: Actions = {
	refund: async (event) => {
		const user = event.locals.user;
		if (!user || (user.role !== 'admin' && user.role !== 'staff')) return fail(403, { message: '返金する権限がありません', paymentId: null as string | null });
		const form = await event.request.formData();
		const paymentId = String(form.get('paymentId') ?? '');
		const amount = Number(form.get('amount'));
		const reason = String(form.get('reason') ?? '').trim().slice(0, 200);
		if (!/^[0-9a-z_-]{3,64}$/i.test(paymentId)) return fail(400, { message: '決済が見つかりません', paymentId });
		if (!Number.isInteger(amount) || amount < 1) return fail(400, { message: '返金する金額を正しく入れてください（1円以上の整数）', paymentId });
		try {
			const r = useSupabaseAdmin
				? await refundInroomPayment(createSupabaseServerClient(event), paymentId, amount, reason)
				: refundInroomPaymentDemo(String(form.get('facilityId') ?? ''), paymentId, amount, reason, user.name);
			if (r.result === 'pending') {
				return fail(502, {
					paymentId,
					message: 'Stripe の応答を確かめられませんでした。返金されたかどうか分からないため、同じ金額で「確認する」を押して確かめてください（重ねて返金はされません）'
				});
			}
			return { refunded: { paymentId, amount: r.amount } };
		} catch (e) {
			return fail(400, { paymentId, message: e instanceof Error ? e.message : '返金できませんでした' });
		}
	}
};
