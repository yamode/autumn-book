// 公式サイト予約のオンライン決済: リダイレクトが必要な決済（一部の3Dセキュア等）の戻り先。
// Stripe が ?payment_intent=pi_…&payment_intent_client_secret=…&redirect_status=… を付けて戻す。
// ここでも Stripe から Intent を取り直して検証してから確定する（URL の値は信用しない）。
import { redirect, type RequestHandler } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { bookingSessionId, clearBookingDraft, getBookingDraft, sbGetHoldMapped } from '$lib/server/supabase-data';
import { confirmDirectIntent } from '$lib/server/direct-payments';
import { finishDirectBooking } from '$lib/server/direct-booking-finish';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const holdId = url.searchParams.get('hold') ?? '';
	const intentId = url.searchParams.get('payment_intent') ?? '';
	const back = (reason: string) => redirect(303, `/booking/hold?id=${encodeURIComponent(holdId)}&pay=${reason}`);
	if (DATA_SOURCE !== 'supabase' || !holdId || !intentId) back('error');

	const sid = bookingSessionId(cookies);
	const hold = await sbGetHoldMapped(holdId, sid);
	if (!hold) redirect(303, '/search');

	let r: Awaited<ReturnType<typeof confirmDirectIntent>>;
	try {
		r = await confirmDirectIntent(intentId, hold.id);
	} catch (e) {
		console.error('[booking/pay/return]', e);
		back('error');
		return new Response(null);
	}
	if (r.result === 'paid' || r.result === 'already') {
		finishDirectBooking(cookies, hold, getBookingDraft(cookies), r);
		clearBookingDraft(cookies);
		redirect(303, `/booking/complete/${r.bookingCode}`);
	}
	if (r.result === 'late') back(r.refunded ? 'late' : 'late_unrefunded');
	back(r.result === 'not_succeeded' ? 'failed' : 'error');
	return new Response(null);
};
