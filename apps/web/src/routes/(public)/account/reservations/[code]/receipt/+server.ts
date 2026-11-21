import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbMyReservations } from '$lib/server/supabase-data';
import { directPaymentForBooking } from '$lib/server/direct-payments';
import { buildBookingReceiptDoc } from '$lib/server/booking-receipt';
import { receiptPdfResponse, renderReceiptPdf } from '$lib/server/inroom-receipt';
import type { RequestHandler } from './$types';

// 会員マイページの予約の領収書 PDF（2026-11-21）。カードのオンライン決済が済んだ予約だけ出す。
// 本人の予約かどうかは my_reservations（本人の予約だけを返す RPC）で確かめる。他人の予約番号を入れても 404。
// 宛名は ?name=（画面の宛名欄）→ 予約のお名前。番号は決済ごとに固定（何度落としても同じ領収書）。
// +server.ts は account の +layout.server.ts を通らないので、ログイン（会員・二段階認証済み）はここで確かめる。

const NO_STORE = { 'cache-control': 'no-store' };

export const GET: RequestHandler = async (event) => {
	const { locals, params, url } = event;
	if (locals.user?.role !== 'member' || locals.memberMfaPending) return new Response('unauthorized', { status: 401, headers: NO_STORE });
	if (!MEMBER_SUPABASE) return new Response('not available', { status: 400, headers: NO_STORE });
	const reservations = await sbMyReservations(createSupabaseServerClient(event)).catch(() => null);
	const r = reservations?.find((x) => x.code === params.code);
	if (!r || r.payment === 'onsite') return new Response('not found', { status: 404, headers: NO_STORE });
	const pay = await directPaymentForBooking(r.code).catch(() => null);
	const doc = await buildBookingReceiptDoc(r, pay, url.searchParams.get('name'));
	if (!doc) return new Response('not found', { status: 404, headers: NO_STORE });
	const pdf = await renderReceiptPdf(doc);
	if (!pdf) return new Response('pdf failed', { status: 503, headers: NO_STORE });
	return receiptPdfResponse(doc, pdf);
};
