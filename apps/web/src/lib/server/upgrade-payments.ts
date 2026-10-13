import { partnerServiceClient } from './partners/admin-client';
import { createPaymentIntent, retrievePaymentIntent, createRefund, listRefunds, inlinePaymentReady, cancelPaymentIntent } from './stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { UpgradeOffer } from '$lib/room-upgrades';
export const UPGRADE_PAYMENT_PURPOSE = 'book_room_upgrade';
export interface UpgradePayment { id: string; offer_id: string; member_user_id: string; amount: number; payment_intent_id: string | null; status: string; expires_at: string }
function service() { const db = partnerServiceClient(); if (!db) throw new Error('オンライン決済は現在ご利用いただけません。'); return db.schema('book'); }
export async function prepareUpgradePayment(client: SupabaseClient, offerId: string, total: number) {
	if (!inlinePaymentReady()) throw new Error('オンライン決済は現在ご利用いただけません。');
	const result = await client.schema('book').rpc('prepare_upgrade_payment', { p_id: offerId, p_consent: true, p_expected_total: total });
	if (result.error) throw result.error;
	const row = result.data as UpgradePayment;
	const intent = row.payment_intent_id ? await retrievePaymentIntent(row.payment_intent_id) : await createPaymentIntent({ amount: row.amount, description: '客室アップグレード追加料金', metadata: { app: 'autumn-book', purpose: UPGRADE_PAYMENT_PURPOSE, upgrade_payment_id: row.id, upgrade_offer_id: offerId }, idempotencyKey: `upgrade-${row.id}` });
	if (!intent.client_secret || intent.amount !== row.amount || intent.currency !== 'jpy' || intent.metadata.upgrade_payment_id !== row.id || intent.metadata.purpose !== UPGRADE_PAYMENT_PURPOSE || intent.metadata.app !== 'autumn-book') throw new Error('お支払いの準備を確認できませんでした。');
	const bound = await service().rpc('bind_upgrade_intent', { p_id: row.id, p_intent: intent.id });
	if (bound.error) throw bound.error;
	return { clientSecret: intent.client_secret, amount: row.amount, expiresAt: row.expires_at };
}
export async function confirmUpgradeIntent(intentId: string, expectedOffer?: string, expectedMember?: string): Promise<{ confirmed: boolean; refunded?: boolean; offer?: UpgradeOffer }> {
	if (!/^pi_[A-Za-z0-9]+$/.test(intentId)) throw new Error('決済が見つかりません。');
	const intent = await retrievePaymentIntent(intentId);
	if (intent.metadata.app !== 'autumn-book' || intent.metadata.purpose !== UPGRADE_PAYMENT_PURPOSE || !intent.metadata.upgrade_payment_id) throw new Error('決済が一致しません。');
	const db = service();
	const { data, error } = await db.from('upgrade_payments').select('*').eq('id', intent.metadata.upgrade_payment_id).maybeSingle();
	if (error || !data) throw new Error('決済の記録が見つかりません。');
	const row = data as UpgradePayment;
	if (row.payment_intent_id !== intent.id || row.offer_id !== intent.metadata.upgrade_offer_id || row.amount !== intent.amount || intent.currency !== 'jpy' || (expectedOffer && row.offer_id !== expectedOffer) || (expectedMember && row.member_user_id !== expectedMember)) throw new Error('決済が一致しません。');
	if (intent.status !== 'succeeded' || intent.amount_received !== row.amount) return { confirmed: false };
	if (row.status === 'refunded') return { confirmed: false, refunded: true };
	const final = await db.rpc('finalize_upgrade_payment', { p_id: row.id, p_intent: intent.id, p_amount: row.amount });
	if (!final.error) return { confirmed: true, offer: final.data as UpgradeOffer };
	// Retry transient/unknown failures, as the DB may have committed successfully.
	if (!['payment_expired', 'offer_unavailable', 'sold_out', 'inventory_missing', 'not_found', 'consent_required'].some(c => final.error!.message.includes(c))) throw final.error;
	await refundUpgradePayment(row);
	return { confirmed: false, refunded: true };
}
async function refundUpgradePayment(row: UpgradePayment) {
	const db = service();
	const pending = await db.rpc('upgrade_payment_refund_pending', { p_id: row.id });
	if (pending.error) throw pending.error;
	if (!row.payment_intent_id) throw new Error('返金する決済が見つかりません。');
	const refund = await createRefund(row.payment_intent_id, `upgrade-refund-${row.id}`, { app: 'autumn-book', purpose: UPGRADE_PAYMENT_PURPOSE, upgrade_payment_id: row.id }, row.amount);
	const currentRefund = (await listRefunds(row.payment_intent_id)).data.find(r => r.id === refund.id) ?? refund;
	const marked = await db.rpc('mark_upgrade_refunded', { p_id: row.id, p_refund: refund.id, p_complete: currentRefund.status === 'succeeded' });
	if (marked.error) throw marked.error;
	if (['failed', 'canceled'].includes(currentRefund.status)) throw new Error('refund requires operator review');
}
export async function refundCancelledUpgrades(bookingCode: string) {
	if (!partnerServiceClient()) return;
	const result = await service().rpc('cancelled_upgrade_refunds', { p_code: bookingCode });
	if (result.error) { if (result.error.code === 'PGRST202') return; throw result.error; }
	for (const row of (result.data ?? []) as UpgradePayment[]) await refundUpgradePayment(row);
}
export async function reconcileUpgradePayments() {
	const result = await service().rpc('upgrade_reconciliation_rows');
	if (result.error) throw result.error;
	const stats = { checked: 0, errors: 0 };
	for (const row of (result.data ?? []) as UpgradePayment[]) {
		try {
			if (!row.payment_intent_id) {
				const closed = await service().rpc('close_unpaid_upgrade_payment', { p_id: row.id });
				if (closed.error) throw closed.error;
				stats.checked++;
				continue;
			}
			const intent = await retrievePaymentIntent(row.payment_intent_id);
			if (intent.status === 'succeeded') await confirmUpgradeIntent(intent.id);
			else if (intent.status === 'canceled' || ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status)) {
				if (intent.status !== 'canceled') await cancelPaymentIntent(intent.id, `upgrade-expired-${row.id}`);
				const closed = await service().rpc('close_unpaid_upgrade_payment', { p_id: row.id });
				if (closed.error) throw closed.error;
			}
			stats.checked++;
		} catch { stats.errors++; }
	}
	return stats;
}
