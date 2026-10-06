// 公式サイト予約のオンライン決済 API（同じ画面で払う・v0.43.0）。予約入力画面（/booking/hold）の決済部品から呼ぶ。
//
//   action=prepare … 予約入力フォーム（FormData）→ 検証 → 仮押さえにお客様情報を結び付けて請求額を DB で決め、
//                    PaymentIntent を用意して client_secret を返す（lib/server/direct-payments.ts）
//   action=confirm … ブラウザで confirmPayment が済んだ連絡（intentId）→ Stripe から Intent を取り直して検証 → 予約確定
//
// 3Dセキュア等でリダイレクトした場合の戻りは /booking/pay/return（GET）。ブラウザが閉じられた場合は Webhook が確定する。
import { json, type RequestHandler } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { MEMBER_SUPABASE } from '$lib/server/auth';
import {
	bookingSessionId,
	clearBookingDraft,
	getBookingDraft,
	sbFacilityByUuid,
	sbGetHoldMapped,
	sbPlanByUuid,
	setBookingDraft
} from '$lib/server/supabase-data';
import { parseGuestForm } from '$lib/server/booking-guest-form';
import { applyPlanAnswers } from '$lib/server/booking-questions';
import { confirmDirectIntent, DirectPaymentError, directPaymentsReady, prepareDirectPayment, viewerIsMember } from '$lib/server/direct-payments';
import { planForViewer } from '$lib/member-payment';
import { payOptionsFor } from '$lib/direct-payment';
import { finishDirectBooking, lateMessage } from '$lib/server/direct-booking-finish';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';

const noStore = { 'cache-control': 'private, no-store' };
const bad = (message: string, status = 400, extra: Record<string, unknown> = {}) => json({ ok: false, message, ...extra }, { status, headers: noStore });

export const POST: RequestHandler = async ({ request, cookies, locals, url }) => {
	if (DATA_SOURCE !== 'supabase') return bad('この環境ではオンライン決済を使えません。', 503);
	const form = await request.formData();
	const action = String(form.get('action') ?? '');
	const sid = bookingSessionId(cookies);
	const memberUserId = MEMBER_SUPABASE && locals.user?.role === 'member' ? locals.user.id : null;

	try {
		if (action === 'prepare') {
			if (!(await directPaymentsReady())) return bad('オンライン決済は現在ご利用いただけません。現地払いをお選びください。', 503);
			const parsed = parseGuestForm(form);
			if (Object.keys(parsed.errors).length > 0) {
				return bad(Object.values(parsed.errors)[0], 400, { errors: parsed.errors });
			}
			const hold = await sbGetHoldMapped(parsed.holdId, sid);
			if (!hold || hold.status !== 'active') return bad(m.error_hold_expired(), 410, { expired: true });
			const [basePlan, facility] = await Promise.all([sbPlanByUuid(hold.planId), sbFacilityByUuid(hold.facilityId)]);
			if (!basePlan || !facility) return bad(m.error_hold_expired(), 410, { expired: true });
			// 非会員は非会員の支払方法で判定（DB の direct_payment_prepare も同じ判定をする）
			const plan = planForViewer(basePlan, viewerIsMember(locals));
			if (!payOptionsFor(plan.payment, { live: true, onlineReady: true }).options.includes('card')) {
				return bad('このプランはオンライン決済をご利用いただけません。', 400);
			}
			// 予約時に聞く項目の回答（「項目名: 回答」を備考の先頭へ）
			const answered = await applyPlanAnswers(form, hold.facilityId, hold.planId, parsed.guest);
			if (!answered.ok) return bad(answered.message, 400, { errors: { questions: answered.message } });
			const prepared = await prepareDirectPayment({
				holdId: hold.id,
				sessionId: sid,
				memberUserId,
				guest: answered.guest,
				pointsUsed: memberUserId ? parsed.pointsRequested : 0,
				locale: getLocale(),
				facilityName: facility.name,
				checkin: hold.checkin,
				// 画面に出していた請求額（早期決済割を含む）。DB の額と違えば Intent を作らずに止める
				expectedAmount: String(form.get('expectedAmount') ?? '').trim() ? Number(form.get('expectedAmount')) : null
			});
			// 完了画面（予約番号・お客様名・割引の名前）用。3Dセキュアの戻り・Webhook 後の画面でも使う
			setBookingDraft(cookies, {
				holdId: hold.id,
				guest: parsed.guest,
				pointsUsed: prepared.pointsUsed,
				payment: 'card',
				prepayDetail: prepared.prepayDetail
			});
			return json(
				{
					ok: true,
					clientSecret: prepared.clientSecret,
					returnUrl: `${url.origin}/booking/pay/return?hold=${encodeURIComponent(hold.id)}`,
					amount: prepared.amount,
					bathTax: prepared.bathTax,
					expiresAt: Date.parse(prepared.expiresAt)
				},
				{ headers: noStore }
			);
		}

		if (action === 'confirm') {
			const intentId = String(form.get('intentId') ?? '');
			const holdId = String(form.get('holdId') ?? '');
			const draft = getBookingDraft(cookies);
			// 確定の前に仮押さえを読む（確定後は converted になるが、完了画面に施設・部屋・プランの id が要る）
			const hold = await sbGetHoldMapped(holdId, sid);
			if (!hold) return bad(m.error_hold_expired(), 410, { expired: true });
			const r = await confirmDirectIntent(intentId, hold.id);
			if (r.result === 'paid' || r.result === 'already') {
				finishDirectBooking(cookies, hold, draft, r);
				clearBookingDraft(cookies);
				return json({ ok: true, redirect: `/booking/complete/${r.bookingCode}` }, { headers: noStore });
			}
			if (r.result === 'late') return bad(lateMessage(r.refunded), 409, { late: true });
			if (r.result === 'not_succeeded') return bad('お支払いがまだ完了していません。', 409);
			return bad('お支払いを確認できませんでした。', 400);
		}

		return bad('不明な操作です。', 400);
	} catch (e) {
		if (e instanceof DirectPaymentError) {
			if (e.code === 'hold_expired') return bad(m.error_hold_expired(), 410, { expired: true });
			if (e.code === 'invalid_guest') return bad('お名前・メールアドレスをご確認ください。', 400);
			if (e.code === 'amount_too_small') return bad('お支払い額が少ないため、オンライン決済をご利用いただけません。現地払いをお選びください。', 400);
			if (e.code === 'already_paid') return bad('このご予約はお支払い済みです。', 409);
			// 画面の請求額と DB の額が違う（日付が変わって早期決済割の段が下がった等）。Intent は作っていない
			if (e.code === 'amount_changed') {
				console.warn('[booking/pay]', e.message);
				return bad(m.pay_notice_amount_changed(), 409, { amountChanged: true });
			}
			console.error('[booking/pay]', e.code, e.message);
			return bad('お支払いの準備ができませんでした。時間をおいてもう一度お試しください。', e.status);
		}
		console.error('[booking/pay]', e);
		return bad('お支払いの処理中に問題が発生しました。時間をおいてもう一度お試しください。', 502);
	}
};
