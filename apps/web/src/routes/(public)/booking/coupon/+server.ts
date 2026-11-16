import { json } from '@sveltejs/kit';
import { MEMBER_SUPABASE } from '$lib/server/auth';
import { bookingSessionId } from '$lib/server/supabase-data';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { couponErrorText } from '$lib/server/booking-coupon';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'private, no-store' };
const invalid = (status = 400) => json({ message: couponErrorText('coupon_invalid') }, { status, headers });

export const POST: RequestHandler = async (event) => {
	const member = event.locals.user;
	if (!MEMBER_SUPABASE || member?.role !== 'member') return invalid(403);
	const form = await event.request.formData();
	const code = String(form.get('code') ?? '').trim().toUpperCase();
	const hold = String(form.get('holdId') ?? '');
	if (!/^[A-Z0-9][A-Z0-9_-]{3,31}$/.test(code) || !/^[a-f0-9-]{36}$/i.test(hold)) return invalid();
	const client = partnerServiceClient();
	if (!client) return invalid(503);
	const { data, error } = await client.schema('book').rpc('member_coupon_code_quote', {
		p_code: code, p_hold_id: hold, p_session_id: bookingSessionId(event.cookies), p_member_user_id: member.id
	});
	if (error || !data || typeof data.amount !== 'number' || typeof data.name !== 'string') return invalid();
	return json({ code, amount: data.amount, name: data.name }, { headers });
};
