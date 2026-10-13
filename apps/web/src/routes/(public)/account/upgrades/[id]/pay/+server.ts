import { json } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { prepareUpgradePayment, confirmUpgradeIntent } from '$lib/server/upgrade-payments';
import { upgradeError } from '$lib/room-upgrades';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async (event) => {
	const headers = { 'cache-control': 'no-store' };
	if (event.locals.user?.role !== 'member' || !MEMBER_SUPABASE) return json({ ok: false, message: '会員本人のログインが必要です。' }, { status: 401, headers });
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
			return json(r.confirmed ? { ok: true } : { ok: false, message: r.refunded ? '受付期限などにより確定できませんでした。追加料金の全額返金手続きを行いました。' : 'お支払いがまだ完了していません。' }, { status: r.confirmed ? 200 : 409, headers });
		}
		throw new Error('invalid_params');
	} catch (e) { return json({ ok: false, message: upgradeError(e) }, { status: 400, headers }); }
};
