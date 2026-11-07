import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import { buildReceiptDoc, findReceiptPayment, receiptPdfResponse, renderReceiptPdf } from '$lib/server/inroom-receipt';
import type { RequestHandler } from './$types';

// 客室案内の領収書 PDF のダウンロード（2026-11-07）。
// 滞在は httpOnly Cookie（ab_stay）の滞在トークンで決まり、その滞在の決済だけ出せる（id を変えても他の滞在の領収書は出ない）。
// 宛名は決済画面で入れたもの（PaymentIntent の metadata）→ 顧客マスタの領収書名義／フルネーム → 滞在コードのお名前。
// メールの送信は決済が確定したときに自動で行う（inroom-bill.ts confirmInroomIntent → autoSendInroomReceipt）。

const NO_STORE = { 'cache-control': 'no-store' };

export const GET: RequestHandler = async ({ cookies, url }) => {
	const token = cookies.get('ab_stay');
	if (!token || DATA_SOURCE !== 'supabase') return new Response('not available', { status: 400, headers: NO_STORE });
	const stay = await sbResolveStay(token);
	if (!stay || stay.isDemo) return new Response('not available', { status: 400, headers: NO_STORE });
	const p = await findReceiptPayment(stay.tokenId, url.searchParams.get('id'));
	if (!p) return new Response('not found', { status: 404, headers: NO_STORE });
	const doc = await buildReceiptDoc(p, null);
	const pdf = await renderReceiptPdf(doc);
	if (!pdf) return new Response('pdf failed', { status: 503, headers: NO_STORE });
	return receiptPdfResponse(doc, pdf);
};
