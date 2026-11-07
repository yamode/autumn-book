import { json } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import { buildReceiptDoc, findReceiptPayment, receiptPdfResponse, renderReceiptPdf, sendReceiptEmail } from '$lib/server/inroom-receipt';
import type { RequestHandler } from './$types';

// 客室案内の領収書（2026-11-07）。GET = PDF をダウンロード／POST = PDF をメールで送る。
// 滞在は httpOnly Cookie（ab_stay）の滞在トークンで決まり、その滞在の決済だけ出せる（id を変えても他の滞在の領収書は出ない）。
// 宛名（name）は任意。空なら滞在コードのお名前。

const NO_STORE = { 'cache-control': 'no-store' };

async function resolve(cookies: { get(name: string): string | undefined }) {
	const token = cookies.get('ab_stay');
	if (!token || DATA_SOURCE !== 'supabase') return null;
	const stay = await sbResolveStay(token);
	return stay && !stay.isDemo ? stay : null;
}

export const GET: RequestHandler = async ({ cookies, url }) => {
	const stay = await resolve(cookies);
	if (!stay) return new Response('not available', { status: 400, headers: NO_STORE });
	const p = await findReceiptPayment(stay.tokenId, url.searchParams.get('id'));
	if (!p) return new Response('not found', { status: 404, headers: NO_STORE });
	const doc = await buildReceiptDoc(p, url.searchParams.get('name'));
	// ?info=1: 画面の宛名欄に入れる既定（顧客マスタの領収書名義 → 顧客のフルネーム → 滞在コードのお名前）
	if (url.searchParams.get('info')) return json({ addressee: doc.addressee }, { headers: NO_STORE });
	const pdf = await renderReceiptPdf(doc);
	if (!pdf) return new Response('pdf failed', { status: 503, headers: NO_STORE });
	return receiptPdfResponse(doc, pdf);
};

export const POST: RequestHandler = async ({ cookies, request }) => {
	const stay = await resolve(cookies);
	if (!stay) return json({ ok: false, kind: 'unavailable' }, { status: 400, headers: NO_STORE });
	const fd = await request.formData();
	const p = await findReceiptPayment(stay.tokenId, String(fd.get('id') ?? '') || null);
	if (!p) return json({ ok: false, kind: 'not_found' }, { status: 404, headers: NO_STORE });
	const doc = await buildReceiptDoc(p, String(fd.get('name') ?? ''));
	const result = await sendReceiptEmail(doc, String(fd.get('email') ?? ''));
	return json({ ok: result === 'sent', kind: result }, { status: result === 'sent' ? 200 : result === 'invalid_email' ? 400 : 502, headers: NO_STORE });
};
