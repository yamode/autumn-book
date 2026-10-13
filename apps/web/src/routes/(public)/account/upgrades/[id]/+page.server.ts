import { error, fail, redirect } from '@sveltejs/kit';
import { myUpgradeOffers } from '$lib/server/room-upgrades';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { upgradeError } from '$lib/room-upgrades';
import { dbg } from '$lib/debug';
import { stripePublishableKey } from '$lib/server/stripe';
import type { Actions, PageServerLoad } from './$types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const load: PageServerLoad = async (event) => {
	if (!uuid.test(event.params.id)) error(404, '提案が見つかりません。');
	const offer = (await myUpgradeOffers(event, event.params.id))[0];
	if (!offer) error(404, '提案が見つかりません。');
	return { offer, stripeKey: offer.payment_mode === 'online' ? stripePublishableKey() : null, paymentResult: event.url.searchParams.get('payment') };
};
export const actions: Actions = {
	accept: async (event) => {
		if (event.locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname)}`);
		if (!MEMBER_SUPABASE || !uuid.test(event.params.id)) return fail(400, { message: 'この環境では操作できません。' });
		const fd = await event.request.formData();
		const total = Number(fd.get('total'));
		if (fd.get('consent') !== 'yes' || !Number.isInteger(total) || total < 0) return fail(400, { message: upgradeError('consent_required') });
		const { error: rpcError } = await createSupabaseServerClient(event).schema('book').rpc('accept_upgrade_offer', { p_id: event.params.id, p_consent: true, p_expected_total: total });
		if (rpcError) { dbg('upgrade acceptance failed', rpcError.code); return fail(400, { message: upgradeError(rpcError) }); }
		return { success: true, message: 'お部屋のアップグレードが確定しました。' };
	},
	decline: async (event) => {
		if (event.locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname)}`);
		if (!MEMBER_SUPABASE || !uuid.test(event.params.id)) return fail(400, { message: 'この環境では操作できません。' });
		const { error: rpcError } = await createSupabaseServerClient(event).schema('book').rpc('decline_upgrade_offer', { p_id: event.params.id });
		if (rpcError) return fail(400, { message: upgradeError(rpcError) });
		return { success: true, message: '提案の見送りを受け付けました。元のご予約はそのままです。' };
	}
};
