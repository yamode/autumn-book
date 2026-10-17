import { json } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import { canTestInroomPayment, confirmInroomIntent, prepareInroomPayment, prepareInroomTestPayment } from '$lib/server/inroom-bill';
import { billPayErrorKind } from '$lib/inroom-bill';
import type { RequestHandler } from './$types';

// 客室案内の精算のオンライン決済（2026-10-17）。action=prepare（PaymentIntent を作る）／confirm（決済後の確定）。
// 滞在は httpOnly Cookie（ab_stay）の滞在トークンで決まる。金額は DB が数え直し、画面の額と違えば断る
export const POST: RequestHandler = async ({ cookies, request, url, locals }) => {
	const headers = { 'cache-control': 'no-store' };
	const token = cookies.get('ab_stay');
	if (!token || DATA_SOURCE !== 'supabase') return json({ ok: false, kind: 'unavailable' }, { status: 400, headers });
	const stay = await sbResolveStay(token);
	if (!stay) return json({ ok: false, kind: 'unavailable' }, { status: 400, headers });
	// 見本（デモ）の滞在は、管理者のテスト決済（本番の Stripe・¥100・PMS に入れない）だけ（2026-10-17）
	if (stay.isDemo && (!canTestInroomPayment(locals) || !locals.user)) return json({ ok: false, kind: 'unavailable' }, { status: 403, headers });
	const fd = await request.formData();
	try {
		if (fd.get('action') === 'prepare' && stay.isDemo && locals.user) {
			const r = await prepareInroomTestPayment(token, locals.user.id);
			return json({ ok: true, ...r, returnUrl: `${url.origin}/r/bill/pay/return` }, { headers });
		}
		if (fd.get('action') === 'prepare') {
			const amount = Number(fd.get('amount'));
			if (!Number.isInteger(amount) || amount < 50) throw new Error('amount_changed');
			// 選んだ請求書（請求書が複数ある滞在だけ）。形が違えば指定なし扱いにせず断る
			const billRaw = String(fd.get('billId') ?? '').trim();
			if (billRaw && !/^[0-9a-f-]{36}$/i.test(billRaw)) throw new Error('amount_changed');
			const r = await prepareInroomPayment(token, amount, billRaw || null);
			return json({ ok: true, ...r, returnUrl: `${url.origin}/r/bill/pay/return` }, { headers });
		}
		if (fd.get('action') === 'confirm') {
			const result = await confirmInroomIntent(String(fd.get('intentId') ?? ''), stay.tokenId);
			return json({ ok: result === 'paid' || result === 'already' || result === 'test', result }, { status: result === 'pending' ? 202 : 200, headers });
		}
		throw new Error('invalid_params');
	} catch (e) {
		console.error('[inroom-bill pay]', e instanceof Error ? e.message : e);
		return json({ ok: false, kind: billPayErrorKind(e) }, { status: 400, headers });
	}
};
