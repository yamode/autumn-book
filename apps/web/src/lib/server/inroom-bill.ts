// 客室案内（/r）の精算案内（2026-10-17・autumn-shared 20261017005358）。型と純関数は $lib/inroom-bill.ts。
//
// ゲスト面:
//   ・明細・出し分け・残額は RPC book.stay_bill（anon・滞在トークン）
//   ・オンライン決済は service_role の RPC（inroom_payment_prepare → Stripe の PaymentIntent → inroom_payment_bind →
//     決済の成立後に inroom_payment_finalize）。確定は画面・リダイレクトの戻り・Webhook のどれからでも同じ処理で、
//     DB の行ロックで1回だけ PMS の請求書に入金行を立てる
//   ・確定時に残額が決済額より少なくなっていた（フロントで先に払った等）ら mismatch → その決済を全額返金
// 管理面: 施設の既定（book.admin_save_inroom_bill_settings）・滞在ごとの上書き（admin_set_stay_bill_override）・
//   一覧（admin_list_stay_bills）。ログイン中スタッフの権限で呼ぶ。
// DATA_SOURCE=demo と見本（デモ）の館内図は、見本の明細（$lib/inroom-bill.ts demoStayBill）。決済はできない。
import type { SupabaseClient } from '@supabase/supabase-js';
import { DATA_SOURCE, supa } from './supabase';
import { FACILITY_UUID } from './supabase-data';
import { partnerServiceClient } from './partners/admin-client';
import { listStayTokens } from './store';
import {
	createPaymentIntent,
	createRefund,
	inlinePaymentReady,
	listRefunds,
	publishableKeyProblem,
	stripeKeyKind,
	retrievePaymentIntent,
	STRIPE_APP_BOOK
} from './stripe';
import {
	demoStayBill,
	EMPTY_NOTE,
	NO_FLAGS,
	PREVIEW_FRONT_NOTE,
	INROOM_TEST_AMOUNT,
	normalizeStayBill,
	resolveBillFlags,
	type BillFlags,
	type FrontNote,
	type StayBillView
} from '$lib/inroom-bill';
import type { StayInfo } from '$lib/types';
import { decideAdminMfaGate } from '$lib/admin-mfa';
import { adminMfaRequired } from './auth';
import { describePublishableKeyIssue } from './payments/keys';

export const STRIPE_PURPOSE_INROOM_BILL = 'book_inroom_bill';

export type BillSettings = { flags: BillFlags; note: FrontNote };
export type BillOverride = { items: boolean | null; front: boolean | null; online: boolean | null };

// ---- デモ（DATA_SOURCE=demo）: プロセス内 ----
const demoSettings = new Map<string, BillSettings>();
const demoOverrides = new Map<string, BillOverride>();

const facilityUuid = (id: string) => FACILITY_UUID[id] ?? id;

// ---------------------------------------------------------------------------
// 施設の既定
// ---------------------------------------------------------------------------
export async function loadBillSettings(facilityId: string): Promise<BillSettings> {
	if (DATA_SOURCE !== 'supabase') return demoSettings.get(facilityId) ?? { flags: NO_FLAGS, note: EMPTY_NOTE };
	try {
		const { data, error } = await supa()
			.from('inroom_settings')
			.select('bill_show_items, bill_show_front, bill_show_online, bill_front_note, bill_front_note_en, bill_front_note_zh')
			.eq('facility_id', facilityUuid(facilityId))
			.maybeSingle();
		if (error || !data) return { flags: NO_FLAGS, note: EMPTY_NOTE };
		return {
			flags: { items: data.bill_show_items === true, front: data.bill_show_front === true, online: data.bill_show_online === true },
			note: { ja: data.bill_front_note ?? '', en: data.bill_front_note_en ?? '', zh: data.bill_front_note_zh ?? '' }
		};
	} catch {
		return { flags: NO_FLAGS, note: EMPTY_NOTE };
	}
}

export function saveBillSettingsDemo(facilityId: string, s: BillSettings): void {
	demoSettings.set(facilityId, s);
}

export async function sbSaveBillSettings(client: SupabaseClient, facilityId: string, s: BillSettings): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_save_inroom_bill_settings', {
		p_facility_id: facilityUuid(facilityId),
		p_show_items: s.flags.items,
		p_show_front: s.flags.front,
		p_show_online: s.flags.online,
		p_note: s.note.ja,
		p_note_en: s.note.en,
		p_note_zh: s.note.zh
	});
	if (error) throw new Error('精算案内の設定を保存できませんでした（' + error.message + '）');
}

// ---------------------------------------------------------------------------
// 滞在ごとの上書き・管理画面の一覧
// ---------------------------------------------------------------------------
export function setStayOverrideDemo(tokenId: string, o: BillOverride): void {
	if (o.items === null && o.front === null && o.online === null) demoOverrides.delete(tokenId);
	else demoOverrides.set(tokenId, o);
}

export async function sbSetStayOverride(client: SupabaseClient, tokenId: string, o: BillOverride): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_set_stay_bill_override', {
		p_token_id: tokenId,
		p_show_items: o.items,
		p_show_front: o.front,
		p_show_online: o.online
	});
	if (error) throw new Error('この滞在の精算案内を保存できませんでした（' + error.message + '）');
}

export type AdminStayBillRow = {
	tokenId: string;
	roomCode: string;
	guestName: string | null;
	validFrom: string;
	validTo: string;
	isDemo: boolean;
	hasStay: boolean;
	override: BillOverride;
	flags: BillFlags;
	dueTotal: number | null;
	paidOnline: number;
};
export type AdminInroomPayment = {
	id: string;
	roomCode: string | null;
	guestName: string | null;
	amount: number;
	status: string;
	paymentIntentId: string | null;
	paidAt: string | null;
	refundedAmount: number;
	message: string | null;
	createdAt: string;
	/** プレビューでのテスト決済（PMS に入れない・返金は手で） */
	isTest: boolean;
};
export type AdminStayBills = { stays: AdminStayBillRow[]; payments: AdminInroomPayment[] };

const boolOrNull = (v: unknown): boolean | null => (v === true ? true : v === false ? false : null);

export function listStayBillsDemo(facilityId: string): AdminStayBills {
	const defaults = demoSettings.get(facilityId)?.flags ?? NO_FLAGS;
	const sample = demoStayBill(NO_FLAGS, EMPTY_NOTE);
	return {
		stays: listStayTokens(facilityId).map((t) => {
			const override = demoOverrides.get(t.id) ?? { items: null, front: null, online: null };
			return {
				tokenId: t.id,
				roomCode: t.roomCode,
				guestName: t.guestName ?? null,
				validFrom: t.validFrom,
				validTo: t.validTo,
				isDemo: false,
				hasStay: true,
				override,
				flags: resolveBillFlags(defaults, override),
				dueTotal: sample.dueTotal,
				paidOnline: 0
			};
		}),
		payments: []
	};
}

export async function sbListStayBills(client: SupabaseClient, facilityId: string): Promise<AdminStayBills> {
	const { data, error } = await client.schema('book').rpc('admin_list_stay_bills', { p_facility: facilityUuid(facilityId) });
	if (error) throw new Error('精算案内の一覧を読めませんでした（' + error.message + '）');
	const d = (data ?? {}) as { stays?: Record<string, unknown>[]; payments?: Record<string, unknown>[] };
	return {
		stays: (d.stays ?? []).map((r) => ({
			tokenId: String(r.token_id),
			roomCode: String(r.room_code ?? ''),
			guestName: (r.guest_name as string | null) ?? null,
			validFrom: String(r.valid_from ?? ''),
			validTo: String(r.valid_to ?? ''),
			isDemo: r.is_demo === true,
			hasStay: r.has_stay === true,
			override: { items: boolOrNull(r.override_items), front: boolOrNull(r.override_front), online: boolOrNull(r.override_online) },
			flags: { items: r.show_items === true, front: r.show_front === true, online: r.show_online === true },
			dueTotal: r.due_total == null ? null : Number(r.due_total),
			paidOnline: Number(r.paid_online ?? 0)
		})),
		payments: (d.payments ?? []).map((p) => ({
			id: String(p.id),
			roomCode: (p.room_code as string | null) ?? null,
			guestName: (p.guest_name as string | null) ?? null,
			amount: Number(p.amount ?? 0),
			status: String(p.status ?? ''),
			paymentIntentId: (p.payment_intent_id as string | null) ?? null,
			paidAt: (p.paid_at as string | null) ?? null,
			refundedAmount: Number(p.refunded_amount ?? 0),
			message: (p.message as string | null) ?? null,
			createdAt: String(p.created_at ?? ''),
			isTest: p.is_test === true
		}))
	};
}

// ---------------------------------------------------------------------------
// ゲスト面: 精算案内の中身
// ---------------------------------------------------------------------------
/**
 * 滞在の精算案内。読めなければ null（客室案内の表示を止めない）。
 * preview は管理画面のプレビューで選んだ出し分け（Cookie ab_preview_bill）。見本の滞在にだけ効かせる
 * （本物の滞在には効かない。見本は決済できないので、オンライン決済を出しても払えない旨の表示になる）。
 */
export async function loadStayBill(token: string, stay: StayInfo, preview: BillFlags | null = null): Promise<StayBillView | null> {
	const previewBill = (flags: BillFlags, note: FrontNote) =>
		demoStayBill(preview ?? flags, preview?.front && !note.ja.trim() ? PREVIEW_FRONT_NOTE : note);
	if (DATA_SOURCE !== 'supabase') {
		const s = demoSettings.get(stay.facility.id) ?? { flags: NO_FLAGS, note: EMPTY_NOTE };
		return previewBill(resolveBillFlags(s.flags, demoOverrides.get(stay.tokenId)), s.note);
	}
	try {
		const { data, error } = await supa().rpc('stay_bill', { p_token: token });
		if (error) return null;
		const view = normalizeStayBill(data);
		if (!view) return null;
		// 見本（デモ）の館内図は滞在に紐づかないので、出し分けだけ本物で、明細は見本
		if (view.isDemo || stay.isDemo) return previewBill(view.flags, view.frontNote);
		return view;
	} catch {
		return null;
	}
}

/** オンライン決済を出せる環境か（Stripe の鍵・service_role・本番データ） */
export const inroomPaymentReady = (): boolean => DATA_SOURCE === 'supabase' && inlinePaymentReady() && partnerServiceClient() !== null;

// ---------------------------------------------------------------------------
// オンライン決済（service_role）
// ---------------------------------------------------------------------------
function service() {
	const c = partnerServiceClient();
	if (!c) throw new Error('unavailable');
	return c.schema('book');
}

type PreparedRow = { id: string; amount: number; payment_intent_id: string | null; room_code: string | null };

/** 準備: DB が残額を数え直し、画面の額と一致したら PaymentIntent を作る（同じ台帳行なら作り直さない） */
export async function prepareInroomPayment(token: string, expected: number): Promise<{ clientSecret: string; amount: number }> {
	if (!inroomPaymentReady()) throw new Error('unavailable');
	const db = service();
	const prepared = await db.rpc('inroom_payment_prepare', { p_token: token, p_expected: expected });
	if (prepared.error) throw new Error(prepared.error.message);
	const row = prepared.data as PreparedRow;
	const intent = row.payment_intent_id
		? await retrievePaymentIntent(row.payment_intent_id)
		: await createPaymentIntent({
				amount: row.amount,
				description: `客室案内のご精算${row.room_code ? `（${row.room_code}）` : ''}`,
				metadata: { app: STRIPE_APP_BOOK, purpose: STRIPE_PURPOSE_INROOM_BILL, inroom_payment_id: row.id },
				idempotencyKey: `inroom-bill-${row.id}`
			});
	if (
		!intent.client_secret ||
		intent.amount !== row.amount ||
		intent.currency !== 'jpy' ||
		intent.metadata.inroom_payment_id !== row.id ||
		intent.metadata.purpose !== STRIPE_PURPOSE_INROOM_BILL ||
		intent.metadata.app !== STRIPE_APP_BOOK
	) {
		throw new Error('intent_mismatch');
	}
	// 一度払われた Intent（succeeded）を使い回さない。確定させてから新しい額で出し直してもらう
	if (intent.status === 'succeeded') {
		await confirmInroomIntent(intent.id);
		throw new Error('amount_changed');
	}
	if (!row.payment_intent_id) {
		const bound = await db.rpc('inroom_payment_bind', { p_id: row.id, p_intent: intent.id });
		if (bound.error) throw new Error(bound.error.message);
	}
	return { clientSecret: intent.client_secret, amount: row.amount };
}

// ---------------------------------------------------------------------------
// プレビューでの本番 Stripe のテスト決済（2026-10-17・autumn-shared 20261017035503）
//   見本（デモ）の滞在トークン＋管理画面にログイン中の管理者（二段階認証の関所を通った人）だけ。
//   金額は DB が決める ¥100 固定。PMS には入れず、自動で返金もしない（Stripe の管理画面から手で返金）
// ---------------------------------------------------------------------------
/** テスト決済を使える人か（管理者・/admin と同じ二段階認証の関所を通っている） */
export function canTestInroomPayment(locals: App.Locals): boolean {
	const user = locals.user;
	if (user?.role !== 'admin') return false;
	return decideAdminMfaGate({ pathname: '/admin', role: user.role, aal: locals.adminAal, required: adminMfaRequired() }) === 'ok';
}

/**
 * テスト決済を出せない理由（2026-10-17・「プレビューで決済テストが表示されない」）。出せるなら null。
 * 見本の滞在でオンライン決済を出す見本のときに、管理画面のスタッフ向けに理由を出す（黙って隠さない）。
 * キーの値は出さない（未登録・形式・テスト/本番の食い違いだけ）
 */
export function inroomTestPaymentBlocker(locals: App.Locals): string | null {
	if (DATA_SOURCE !== 'supabase') return 'デモ（DATA_SOURCE=demo）では Stripe に繋がないため、テスト決済はできません';
	const kind = stripeKeyKind();
	if (kind === 'missing') return 'Stripe のシークレットキー（STRIPE_SECRET_KEY）が Book に登録されていません（Cloudflare のシークレット）';
	if (kind !== 'secret' && kind !== 'restricted') return 'Stripe のシークレットキー（STRIPE_SECRET_KEY）の形式が違います（sk_ / rk_ で始まるキーを登録してください）';
	const pk = publishableKeyProblem();
	if (pk) return describePublishableKeyIssue(pk);
	if (!partnerServiceClient()) return 'SUPABASE_SERVICE_ROLE_KEY が Book に登録されていません';
	const user = locals.user;
	if (user?.role !== 'admin') return user?.role === 'staff' ? 'テスト決済は管理者だけが試せます（スタッフでログイン中）' : 'この端末は管理画面に管理者としてログインしていません';
	if (!canTestInroomPayment(locals)) return '二段階認証（パスキーか認証アプリ）の確認が済んでいません。管理画面で確認してから開き直してください';
	return null;
}

/** テスト決済の準備（¥100 の PaymentIntent。同じ台帳行なら作り直さない） */
export async function prepareInroomTestPayment(token: string, adminId: string): Promise<{ clientSecret: string; amount: number }> {
	if (!inroomPaymentReady()) throw new Error('unavailable');
	const db = service();
	const prepared = await db.rpc('inroom_test_payment_prepare', { p_token: token, p_admin: adminId });
	if (prepared.error) throw new Error(prepared.error.message);
	const row = prepared.data as PreparedRow;
	if (row.amount !== INROOM_TEST_AMOUNT) throw new Error('intent_mismatch');
	const intent = row.payment_intent_id
		? await retrievePaymentIntent(row.payment_intent_id)
		: await createPaymentIntent({
				amount: row.amount,
				description: `客室案内のテスト決済（プレビュー・見本の滞在${row.room_code ? `・${row.room_code}` : ''}）`,
				metadata: { app: STRIPE_APP_BOOK, purpose: STRIPE_PURPOSE_INROOM_BILL, inroom_payment_id: row.id, test: 'preview' },
				idempotencyKey: `inroom-test-${row.id}`
			});
	if (
		!intent.client_secret ||
		intent.amount !== row.amount ||
		intent.currency !== 'jpy' ||
		intent.metadata.inroom_payment_id !== row.id ||
		intent.metadata.purpose !== STRIPE_PURPOSE_INROOM_BILL ||
		intent.metadata.app !== STRIPE_APP_BOOK
	) {
		throw new Error('intent_mismatch');
	}
	// 払い済みの Intent を使い回さない（確定させて、次は新しい台帳行で）
	if (intent.status === 'succeeded') {
		await confirmInroomIntent(intent.id);
		throw new Error('amount_changed');
	}
	if (!row.payment_intent_id) {
		const bound = await db.rpc('inroom_payment_bind', { p_id: row.id, p_intent: intent.id });
		if (bound.error) throw new Error(bound.error.message);
	}
	return { clientSecret: intent.client_secret, amount: row.amount };
}

/** 'test' はプレビューでのテスト決済が通った（PMS には入れない・返金は手で） */
export type InroomConfirmResult = 'paid' | 'already' | 'pending' | 'refunded' | 'test';

/**
 * 確定: Stripe から Intent を取り直して検証し、DB で入金行を立てる。
 * expectedTokenId を渡すと、その滞在の決済でなければ断る（画面からの確定はお客様の Cookie の滞在で確かめる）
 */
export async function confirmInroomIntent(intentId: string, expectedTokenId?: string): Promise<InroomConfirmResult> {
	if (!/^pi_[A-Za-z0-9]+$/.test(intentId)) throw new Error('not_found');
	const intent = await retrievePaymentIntent(intentId);
	if (intent.metadata.app !== STRIPE_APP_BOOK || intent.metadata.purpose !== STRIPE_PURPOSE_INROOM_BILL || !intent.metadata.inroom_payment_id) {
		throw new Error('intent_mismatch');
	}
	const db = service();
	const got = await db.rpc('inroom_payment_get', { p_id: intent.metadata.inroom_payment_id });
	const row = got.data as { id: string; token_id: string | null; amount: number; payment_intent_id: string | null; status: string } | null;
	if (got.error || !row?.id) throw new Error('not_found');
	if (row.payment_intent_id !== intent.id || row.amount !== intent.amount || intent.currency !== 'jpy') throw new Error('intent_mismatch');
	if (expectedTokenId && row.token_id !== expectedTokenId) throw new Error('intent_mismatch');
	if (intent.status !== 'succeeded' || intent.amount_received !== row.amount) return 'pending';

	const fin = await db.rpc('inroom_payment_finalize', { p_id: row.id, p_intent: intent.id, p_amount: row.amount });
	if (fin.error) throw new Error(fin.error.message);
	const result = (fin.data as { result?: string } | null)?.result;
	if (result === 'paid') return 'paid';
	if (result === 'already') return 'already';
	if (result === 'test_paid') return 'test';
	// mismatch: 残額が足りなかった → その決済を全額返金
	await refundInroomMismatch(row.id, intent.id, row.amount);
	return 'refunded';
}

async function refundInroomMismatch(id: string, intentId: string, amount: number): Promise<void> {
	const db = service();
	let ok = false;
	let refundId: string | null = null;
	try {
		const refund = await createRefund(
			intentId,
			`inroom-bill-mismatch-${id}`,
			{ app: STRIPE_APP_BOOK, purpose: STRIPE_PURPOSE_INROOM_BILL, inroom_payment_id: id },
			amount
		);
		refundId = refund.id;
		ok = !['failed', 'canceled'].includes(refund.status);
	} catch {
		ok = false;
	}
	await db.rpc('inroom_payment_mark_mismatch_refunded', { p_id: id, p_refund_id: refundId, p_ok: ok });
	if (!ok) throw new Error('refund_failed');
}

/** 管理画面「返金を再実行」（金額の食い違いで返金に失敗した決済） */
export async function retryInroomMismatchRefund(id: string): Promise<void> {
	const db = service();
	const got = await db.rpc('inroom_payment_get', { p_id: id });
	const row = got.data as { id: string; amount: number; payment_intent_id: string | null; status: string } | null;
	if (got.error || !row?.id || !row.payment_intent_id) throw new Error('決済が見つかりません');
	if (!['mismatch', 'refund_failed'].includes(row.status)) throw new Error('返金の対象ではありません');
	await refundInroomMismatch(row.id, row.payment_intent_id, row.amount);
}

/**
 * Webhook charge.refunded（Stripe の管理画面から返金した）。客室案内の決済でなければ 'not_ours'。
 * 返金済みの合計（charge.amount_refunded）までの差額だけ、PMS にマイナスの入金行を立てる
 */
export async function syncInroomRefundFromStripe(charge: { payment_intent?: unknown; amount_refunded?: unknown }): Promise<'recorded' | 'already' | 'not_ours'> {
	const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
	if (!intent) return 'not_ours';
	const c = partnerServiceClient();
	if (!c) return 'not_ours';
	let total = Number(charge.amount_refunded ?? NaN);
	let refundId: string | null = null;
	try {
		const refunds = (await listRefunds(intent)).data.filter((r) => r.status === 'succeeded' || r.status === 'pending');
		refundId = refunds[0]?.id ?? null;
		if (!Number.isFinite(total)) total = refunds.reduce((s, r) => s + r.amount, 0);
	} catch {
		if (!Number.isFinite(total)) return 'not_ours';
	}
	const { data, error } = await c.schema('book').rpc('inroom_payment_sync_refund', {
		p_intent: intent,
		p_refunded_total: Math.round(total),
		p_refund_id: refundId
	});
	if (error) throw new Error(error.message);
	const result = (data as { result?: string } | null)?.result;
	return result === 'not_ours' ? 'not_ours' : result === 'recorded' ? 'recorded' : 'already';
}
