import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { activeBookMember, bookingMuseEnabled, MUSE_CLIENT_ID, MUSE_PORTAL_CLIENT_ID, privatePageHeaders } from '$lib/server/booking-mcp/oauth';
import { cancellationTextFor, onsiteAnswers, onsiteFields } from '$lib/server/booking-mcp/onsite';
import { resolveStandardFields } from '$lib/booking-standard-fields';
import { ONSITE_METHODS } from '$lib/direct-payment';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

const input = z.object(onsiteFields);

async function review(event: RequestEvent) {
	const { params, locals, url } = event;
	event.setHeaders({ ...privatePageHeaders, 'content-security-policy': "frame-ancestors 'none'" });
	if (!bookingMuseEnabled(url) || !z.string().uuid().safeParse(params.review).success) error(404);
	if (locals.user?.role !== 'member') redirect(303, '/auth/login?next=' + encodeURIComponent(url.pathname));
	const userId = locals.user.id;
	if (!await activeBookMember(userId)) error(403);
	const db = partnerServiceClient()?.schema('book');
	if (!db) error(503, '予約内容を読み込めませんでした。');
	const { data, error: lookupError } = await db.from('booking_mcp_reviews')
		.select('checkin, nights, adults, expires_at, snapshot, booking_code, client_id, generation')
		.eq('id', params.review).eq('user_id', userId).in('client_id', [MUSE_CLIENT_ID, MUSE_PORTAL_CLIENT_ID]).maybeSingle();
	if (lookupError) error(503, '予約内容を読み込めませんでした。');
	if (!data) error(404, '確認画面を開けません。Museで空室を検索し直してください。');
	const { data: grant, error: grantError } = await db.from('booking_mcp_grants').select('user_id')
		.eq('user_id', userId).eq('client_id', data.client_id).eq('booking_generation', data.generation)
		.gt('grant_expires_at', new Date().toISOString()).maybeSingle();
	if (grantError) error(503, '連携を確認できませんでした。');
	if (!grant) error(410, 'Museとの連携が変わりました。Museで確認画面を開き直してください。');
	return { db, userId, row: data };
}

export const load: PageServerLoad = async (event) => {
	const { row } = await review(event);
	const { snapshot } = row;
	return {
		checkin: row.checkin as string, nights: row.nights as number, adults: row.adults as number,
		closed: Date.parse(row.expires_at) <= Date.now(),
		bookingCode: row.booking_code as string | null,
		facility: snapshot.facilityName as string, plan: snapshot.planName as string, room: snapshot.roomName as string,
		lodging: snapshot.lodging as number, bathTax: snapshot.bathTax as number,
		cancellation: cancellationTextFor(snapshot.policy, row.checkin),
		fields: resolveStandardFields(snapshot.fields), askGender: Boolean(snapshot.form.ask_gender),
		methods: ONSITE_METHODS.filter((method) => snapshot.onsiteMethods.includes(method))
	};
};

export const actions: Actions = {
	default: async (event) => {
		if (event.request.headers.get('origin') !== event.url.origin) error(403);
		const { db, userId, row } = await review(event);
		const form = await event.request.formData();
		const submitted = Object.fromEntries(Object.keys(onsiteFields).map((key) => [key, String(form.get(key) ?? '')]));
		if (row.booking_code) redirect(303, event.url.pathname);
		const parsed = input.safeParse(submitted);
		if (form.get('agreed') !== 'yes' || !parsed.success) return fail(400, { message: '予約内容をご確認のうえ、必須項目を入力してください。' });
		const validated = onsiteAnswers(row.snapshot, row.adults, parsed.data);
		if (!validated.answers) return fail(400, { message: validated.message });
		const { contactSignature: _signature, ...snapshot } = row.snapshot;
		const { error: rpcError } = await db.rpc('approve_mcp_muse_booking', {
			p_user: userId, p_review: event.params.review, p_snapshot: snapshot, p_answers: validated.answers, p_method: parsed.data.onsiteMethod
		});
		if (rpcError) {
			if (['review_expired', 'review_changed', 'forbidden', 'onsite_not_allowed', 'not_sellable'].includes(rpcError.message) || rpcError.message.startsWith('sold_out:')) {
				return fail(409, { message: '確認期限が切れたか、予約条件が変わりました。Museで空室を検索し直してください。' });
			}
			return fail(503, { message: '確定結果を確認できませんでした。同じ確認画面を更新してから、もう一度お試しください。' });
		}
		redirect(303, event.url.pathname);
	}
};
