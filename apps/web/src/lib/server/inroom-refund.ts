// 客室案内の精算（オンライン決済・Stripe）の「精算済み」一覧と返金（2026-10-18 指示
// 「客室精算が終わったお客様を Book の管理画面から確認できるように。そこから一部返金や全額返金の処理もできるように」・
// autumn-shared 20261018061644）。PMS の Square 返金（請求書画面・既定は全額・減らすと一部返金・理由・確認）と同じ考え方。
//
// 返金の流れ（二重返金を作らない）:
//   1) admin_inroom_refund_begin（ログイン中スタッフの権限）… DB が状態と返せる額を数え直し、pending の返金行を立てる。
//      1決済につき pending は1つだけ。同じ額でもう一度押すと同じ行が返る（応答が読めなかった返金の再確認）
//   2) Stripe の返金。冪等キーは返金行の id から作る（同じ行なら何度投げても Stripe 側の返金は1つ）
//   3) inroom_refund_settle（service_role）で結果を記録
//   4) inroom_payment_sync_refund（syncInroomRefundFromStripe）で台帳の返金額と PMS のマイナスの入金行。
//      Stripe の Webhook（charge.refunded）も同じ関数を通るので、どちらが先でも二重に入らない
// DATA_SOURCE=demo はプロセス内の見本（Stripe には繋がない）。
import type { SupabaseClient } from '@supabase/supabase-js';
import { FACILITY_UUID } from './supabase-data';
import { partnerServiceClient } from './partners/admin-client';
import { createRefund, STRIPE_APP_BOOK, StripeError } from './stripe';
import { STRIPE_PURPOSE_INROOM_BILL, syncInroomRefundFromStripe } from './inroom-bill';

export type InroomRefundRow = {
	id: string;
	amount: number;
	reason: string | null;
	status: 'pending' | 'succeeded' | 'failed' | string;
	stripeRefundId: string | null;
	message: string | null;
	createdByName: string | null;
	createdAt: string;
};
export type SettledInroomPayment = {
	id: string;
	roomCode: string | null;
	guestName: string | null;
	amount: number;
	status: string;
	isTest: boolean;
	paymentIntentId: string | null;
	paidAt: string | null;
	createdAt: string;
	refundedAmount: number;
	message: string | null;
	validFrom: string | null;
	validTo: string | null;
	bills: { billId: string | null; billNo: string | null; name: string | null; amount: number }[];
	refunds: InroomRefundRow[];
	/** 受付中（Stripe の結果を確かめられていない）の返金 */
	pendingRefund: { id: string; amount: number } | null;
	/** あといくら返せるか（入金済み・一部返金・テスト決済だけ） */
	refundable: number;
};

const facilityUuid = (id: string) => FACILITY_UUID[id] ?? id;
const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

function normalize(p: Record<string, unknown>): SettledInroomPayment {
	const pending = p.pending_refund as Record<string, unknown> | null;
	return {
		id: String(p.id),
		roomCode: str(p.room_code),
		guestName: str(p.guest_name),
		amount: Number(p.amount ?? 0),
		status: String(p.status ?? ''),
		isTest: p.is_test === true,
		paymentIntentId: str(p.payment_intent_id),
		paidAt: str(p.paid_at),
		createdAt: String(p.created_at ?? ''),
		refundedAmount: Number(p.refunded_amount ?? 0),
		message: str(p.message),
		validFrom: str(p.valid_from),
		validTo: str(p.valid_to),
		bills: ((p.bills as Record<string, unknown>[] | null) ?? []).map((b) => ({
			billId: str(b.bill_id),
			billNo: str(b.bill_no),
			name: str(b.name),
			amount: Number(b.amount ?? 0)
		})),
		refunds: ((p.refunds as Record<string, unknown>[] | null) ?? []).map((r) => ({
			id: String(r.id),
			amount: Number(r.amount ?? 0),
			reason: str(r.reason),
			status: String(r.status ?? ''),
			stripeRefundId: str(r.stripe_refund_id),
			message: str(r.message),
			createdByName: str(r.created_by_name),
			createdAt: String(r.created_at ?? '')
		})),
		pendingRefund: pending?.id ? { id: String(pending.id), amount: Number(pending.amount ?? 0) } : null,
		refundable: Number(p.refundable ?? 0)
	};
}

export async function sbListSettledPayments(client: SupabaseClient, facilityId: string, from: string, to: string): Promise<SettledInroomPayment[]> {
	const { data, error } = await client
		.schema('book')
		.rpc('admin_list_inroom_payments', { p_facility: facilityUuid(facilityId), p_from: from, p_to: to });
	if (error) throw new Error('精算済みの一覧を読めませんでした（' + error.message + '）');
	return (((data ?? {}) as { payments?: Record<string, unknown>[] }).payments ?? []).map(normalize);
}

/** 返金の結果。'pending' は Stripe の応答を確かめられなかった（同じ額でもう一度押すと確かめ直す） */
export type InroomRefundResult = { result: 'refunded' | 'pending'; amount: number; stripeRefundId: string | null };

const BEGIN_ERRORS: Record<string, string> = {
	not_refundable: 'この決済は返金できません（入金済みの決済だけ返金できます）',
	over_refundable: '返金できる額を超えています。画面を読み直してください',
	refund_in_progress: 'この決済には確認中の返金があります。先にその返金を「確認する」で確かめてください',
	invalid_amount: '返金する金額を正しく入れてください',
	forbidden: 'この施設の決済を返金する権限がありません',
	not_found: '決済が見つかりません'
};

/** 返金する（一部・全額）。返す額は DB が数え直す */
export async function refundInroomPayment(client: SupabaseClient, paymentId: string, amount: number, reason: string): Promise<InroomRefundResult> {
	const svc = partnerServiceClient();
	if (!svc) throw new Error('SUPABASE_SERVICE_ROLE_KEY が Book に登録されていないため返金できません');
	const begun = await client.schema('book').rpc('admin_inroom_refund_begin', { p_payment: paymentId, p_amount: amount, p_reason: reason });
	if (begun.error) {
		const code = Object.keys(BEGIN_ERRORS).find((k) => begun.error.message.includes(k));
		throw new Error(code ? BEGIN_ERRORS[code] : '返金を受け付けられませんでした（' + begun.error.message + '）');
	}
	const b = begun.data as { refund_id: string; payment_id: string; payment_intent_id: string; amount: number };
	const db = svc.schema('book');

	let refund: { id: string; status: string; amount: number };
	try {
		refund = await createRefund(
			b.payment_intent_id,
			`inroom-admin-refund-${b.refund_id}`,
			{ app: STRIPE_APP_BOOK, purpose: STRIPE_PURPOSE_INROOM_BILL, inroom_payment_id: b.payment_id, inroom_refund_id: b.refund_id },
			b.amount
		);
	} catch (e) {
		// Stripe がはっきり断った（4xx）ときだけ失敗にする。通信の失敗・5xx は返金されたか分からないので pending のまま
		if (e instanceof StripeError && e.status >= 400 && e.status < 500) {
			await db.rpc('inroom_refund_settle', { p_refund: b.refund_id, p_ok: false, p_stripe_refund_id: null, p_message: e.message });
			throw new Error('Stripe が返金を受け付けませんでした（' + e.message + '）');
		}
		return { result: 'pending', amount: b.amount, stripeRefundId: null };
	}
	const ok = !['failed', 'canceled'].includes(refund.status);
	await db.rpc('inroom_refund_settle', {
		p_refund: b.refund_id,
		p_ok: ok,
		p_stripe_refund_id: refund.id,
		p_message: ok ? (refund.status === 'succeeded' ? null : `Stripe: ${refund.status}`) : `Stripe: ${refund.status}`
	});
	if (!ok) throw new Error(`Stripe で返金が失敗しました（${refund.status}）`);
	// 台帳の返金額と PMS のマイナスの入金行（Stripe の返金合計まで・Webhook と同じ関数）
	await syncInroomRefundFromStripe({ payment_intent: b.payment_intent_id });
	return { result: 'refunded', amount: b.amount, stripeRefundId: refund.id };
}

// ---------------------------------------------------------------------------
// デモ（DATA_SOURCE=demo）: プロセス内の見本
// ---------------------------------------------------------------------------
const demoPayments = new Map<string, SettledInroomPayment[]>();

function demoSeed(): SettledInroomPayment[] {
	const day = (offset: number, h: number) => {
		const d = new Date(Date.now() - offset * 86400000);
		d.setUTCHours(h - 9, 12, 0, 0);
		return d.toISOString();
	};
	const base = (id: string, room: string, guest: string, amount: number, at: string, billNo: string): SettledInroomPayment => ({
		id,
		roomCode: room,
		guestName: guest,
		amount,
		status: 'paid',
		isTest: false,
		paymentIntentId: `pi_demo_${id}`,
		paidAt: at,
		createdAt: at,
		refundedAmount: 0,
		message: null,
		validFrom: at,
		validTo: at,
		bills: [{ billId: null, billNo, name: `${guest} 様`, amount }],
		refunds: [],
		pendingRefund: null,
		refundable: amount
	});
	const partial = base('demo3', '202', '高橋 一郎', 12400, day(2, 10), '00121');
	partial.status = 'partially_refunded';
	partial.refundedAmount = 2000;
	partial.refundable = 10400;
	partial.refunds = [
		{ id: 'r1', amount: 2000, reason: '飲み物の重複', status: 'succeeded', stripeRefundId: 're_demo1', message: null, createdByName: 'front@example.jp', createdAt: day(2, 11) }
	];
	return [base('demo1', '101', '山田 花子', 8600, day(0, 9), '00131'), base('demo2', '105', '佐藤 太郎', 23100, day(1, 10), '00127'), partial];
}

export function listSettledPaymentsDemo(facilityId: string, from: string, to: string): SettledInroomPayment[] {
	if (!demoPayments.has(facilityId)) demoPayments.set(facilityId, demoSeed());
	const jstDay = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10);
	return (demoPayments.get(facilityId) ?? []).filter((p) => {
		const d = jstDay(p.paidAt ?? p.createdAt);
		return d >= from && d <= to;
	});
}

export function refundInroomPaymentDemo(facilityId: string, paymentId: string, amount: number, reason: string, by: string | null): InroomRefundResult {
	const p = (demoPayments.get(facilityId) ?? []).find((x) => x.id === paymentId);
	if (!p) throw new Error(BEGIN_ERRORS.not_found);
	if (!['paid', 'partially_refunded', 'test_paid'].includes(p.status)) throw new Error(BEGIN_ERRORS.not_refundable);
	if (!Number.isInteger(amount) || amount < 1) throw new Error(BEGIN_ERRORS.invalid_amount);
	if (amount > p.amount - p.refundedAmount) throw new Error(BEGIN_ERRORS.over_refundable);
	const id = `re_demo_${Date.now()}`;
	p.refunds.push({ id, amount, reason: reason || null, status: 'succeeded', stripeRefundId: id, message: null, createdByName: by, createdAt: new Date().toISOString() });
	p.refundedAmount += amount;
	p.refundable = p.amount - p.refundedAmount;
	p.status = p.refundedAmount >= p.amount ? 'refunded' : 'partially_refunded';
	return { result: 'refunded', amount, stripeRefundId: id };
}
