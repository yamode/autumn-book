import { partnerServiceClient } from './partners/admin-client';

export type ReceiptTracking = {
	trackingStartedAt: string | null;
	downloadedAt: string | null;
	emailedAt: string | null;
};

/** 呼び出し元のスタッフ権限で取得済みの決済だけを補足する。未認可IDを渡さない。 */
export async function receiptTrackingForAuthorizedPayments(ids: string[]): Promise<Record<string, ReceiptTracking>> {
	if (!ids.length) return {};
	const client = partnerServiceClient();
	if (!client) return {};
	const { data, error } = await client.schema('book').from('inroom_payments')
		.select('id, receipt_tracking_started_at, receipt_downloaded_at, receipt_emailed_at').in('id', ids);
	if (error) {
		console.error('[inroom-receipt] 発行履歴を取得できませんでした', error.message);
		return {};
	}
	return Object.fromEntries((data ?? []).map((p) => [p.id, {
		trackingStartedAt: p.receipt_tracking_started_at,
		downloadedAt: p.receipt_downloaded_at,
		emailedAt: p.receipt_emailed_at
	}]));
}

/** PDF応答の提供・メール送信が成功した場合だけ記録する。記録失敗で決済・送信を再実行しない。 */
export async function recordReceiptDelivery(paymentId: string, channel: 'download' | 'email'): Promise<void> {
	try {
		const client = partnerServiceClient();
		if (!client) throw new Error('unavailable');
		const field = channel === 'download' ? 'receipt_downloaded_at' : 'receipt_emailed_at';
		const { error } = await client.schema('book').from('inroom_payments')
			.update({ [field]: new Date().toISOString() }).eq('id', paymentId).is(field, null);
		if (error) throw error;
	} catch (e) {
		console.error('[inroom-receipt] 発行履歴を記録できませんでした', paymentId, e);
	}
}
