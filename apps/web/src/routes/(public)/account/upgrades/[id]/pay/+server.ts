import { json } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { prepareUpgradePayment, confirmUpgradeIntent } from '$lib/server/upgrade-payments';
import { memberUpgradeError } from '$lib/room-upgrades';
import * as m from '$lib/paraglide/messages';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	const headers = { 'cache-control': 'no-store' };
	if (event.locals.user?.role !== 'member' || !MEMBER_SUPABASE) return json({ ok: false, message: m.upgrade_login_required() }, { status: 401, headers });
	const fd = await event.request.formData();
	try {
		if (fd.get('action') === 'prepare') {
			if (fd.get('consent') !== 'yes') throw new Error('consent_required');
			const amount = Number(fd.get('total'));
			if (!Number.isInteger(amount) || amount < 50) throw new Error('invalid_params');
			const r = await prepareUpgradePayment(createSupabaseServerClient(event), event.params.id, amount);
			return json({ ok: true, ...r, returnUrl: `${event.url.origin}/account/upgrades/${event.params.id}/pay/return` }, { headers });
		}
		if (fd.get('action') === 'confirm') {
			const r = await confirmUpgradeIntent(String(fd.get('intentId') ?? ''), event.params.id, event.locals.user.id);
			return json(r.confirmed ? { ok: true } : { ok: false, message: r.refunded ? m.upgrade_pay_refunded() : m.upgrade_pay_incomplete() }, { status: r.confirmed ? 200 : 409, headers });
		}
		throw new Error('invalid_params');
	} catch (e) { return json({ ok: false, message: memberUpgradeError(e) }, { status: 400, headers }); }
};
