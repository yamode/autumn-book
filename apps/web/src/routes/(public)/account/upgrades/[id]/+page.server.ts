import { error, fail, redirect } from '@sveltejs/kit';
import { decidePreviewUpgrade, myUpgradeOffers } from '$lib/server/room-upgrades';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { memberUpgradeError } from '$lib/room-upgrades';
import * as m from '$lib/paraglide/messages';
import { dbg } from '$lib/debug';
import { stripePublishableKey } from '$lib/server/stripe';
import type { Actions, PageServerLoad } from './$types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const load: PageServerLoad = async (event) => {
	if (event.locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	if (!uuid.test(event.params.id)) error(404, m.upgrade_error_not_found());
	const offer = (await myUpgradeOffers(event, event.params.id))[0];
	if (!offer) error(404, m.upgrade_error_not_found());
	return { offer, stripeKey: offer.payment_mode === 'online' ? stripePublishableKey() : null, paymentResult: event.url.searchParams.get('payment') };
};
export const actions: Actions = {
	accept: async (event) => {
		if (event.locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname)}`);
		if ((!MEMBER_SUPABASE && !event.locals.memberPreview) || !uuid.test(event.params.id)) return fail(400, { message: m.account_env_unavailable() });
		const fd = await event.request.formData();
		const total = Number(fd.get('total'));
		if (fd.get('consent') !== 'yes' || !Number.isInteger(total) || total < 0) return fail(400, { message: memberUpgradeError('consent_required') });
		if (event.locals.memberPreview) return decidePreviewUpgrade(event, event.params.id, 'accepted', total)
			? { success: true, message: m.upgrade_preview_accepted() }
			: fail(400, { message: memberUpgradeError('offer_unavailable') });
		const { error: rpcError } = await createSupabaseServerClient(event).schema('book').rpc('accept_upgrade_offer', { p_id: event.params.id, p_consent: true, p_expected_total: total });
		if (rpcError) { dbg('upgrade acceptance failed', rpcError.code); return fail(400, { message: memberUpgradeError(rpcError) }); }
		return { success: true, message: m.upgrade_accepted_message() };
	},
	decline: async (event) => {
		if (event.locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname)}`);
		if (event.locals.memberPreview) return decidePreviewUpgrade(event, event.params.id, 'declined')
			? { success: true, message: m.upgrade_preview_declined() }
			: fail(400, { message: memberUpgradeError('offer_unavailable') });
		if (!MEMBER_SUPABASE || !uuid.test(event.params.id)) return fail(400, { message: m.account_env_unavailable() });
		const { error: rpcError } = await createSupabaseServerClient(event).schema('book').rpc('decline_upgrade_offer', { p_id: event.params.id });
		if (rpcError) return fail(400, { message: memberUpgradeError(rpcError) });
		return { success: true, message: m.upgrade_declined_message() };
	}
};
