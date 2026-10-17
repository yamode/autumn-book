import { json } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import { confirmInroomIntent, prepareInroomPayment } from '$lib/server/inroom-bill';
import { billPayErrorKind } from '$lib/inroom-bill';
import type { RequestHandler } from './$types';

// 客室案内の精算のオンライン決済（2026-10-17）。action=prepare（PaymentIntent を作る）／confirm（決済後の確定）。
// 滞在は httpOnly Cookie（ab_stay）の滞在トークンで決まる。金額は DB が数え直し、画面の額と違えば断る
export const POST: RequestHandler = async ({ cookies, request, url }) => {
	const headers = { 'cache-control': 'no-store' };
	const token = cookies.get('ab_stay');
	if (!token || DATA_SOURCE !== 'supabase') return json({ ok: false, kind: 'unavailable' }, { status: 400, headers });
	const stay = await sbResolveStay(token);
	if (!stay || stay.isDemo) return json({ ok: false, kind: 'unavailable' }, { status: 400, headers });
	const fd = await request.formData();
	try {
		if (fd.get('action') === 'prepare') {
			const amount = Number(fd.get('amount'));
			if (!Number.isInteger(amount) || amount < 50) throw new Error('amount_changed');
			const r = await prepareInroomPayment(token, amount);
			return json({ ok: true, ...r, returnUrl: `${url.origin}/r/bill/pay/return` }, { headers });
		}
		if (fd.get('action') === 'confirm') {
			const result = await confirmInroomIntent(String(fd.get('intentId') ?? ''), stay.tokenId);
			return json({ ok: result === 'paid' || result === 'already', result }, { status: result === 'pending' ? 202 : 200, headers });
		}
		throw new Error('invalid_params');
	} catch (e) {
		console.error('[inroom-bill pay]', e instanceof Error ? e.message : e);
		return json({ ok: false, kind: billPayErrorKind(e) }, { status: 400, headers });
	}
};
