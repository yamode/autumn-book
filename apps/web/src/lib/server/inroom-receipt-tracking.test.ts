import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('./partners/admin-client', () => ({ partnerServiceClient: mock.client }));
import { receiptTrackingForAuthorizedPayments, recordReceiptDelivery } from './inroom-receipt-tracking';

describe('領収書の発行履歴', () => {
	beforeEach(() => { vi.restoreAllMocks(); mock.client.mockReset(); });
	it('認可された決済がなければサービス権限で問い合わせない', async () => {
		expect(await receiptTrackingForAuthorizedPayments([])).toEqual({});
		expect(mock.client).not.toHaveBeenCalled();
	});
	it('取得に失敗した場合は未発行と断定する履歴を作らない', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const inIds = vi.fn().mockResolvedValue({ data: null, error: { message: 'failed' } });
		mock.client.mockReturnValue({ schema: () => ({ from: () => ({ select: () => ({ in: inIds }) }) }) });
		expect(await receiptTrackingForAuthorizedPayments(['authorized-payment'])).toEqual({});
		expect(inIds).toHaveBeenCalledWith('id', ['authorized-payment']);
	});
	it.each([['download', 'receipt_downloaded_at'], ['email', 'receipt_emailed_at']] as const)('%s の初回日時を上書きしない', async (channel, field) => {
		const isNull = vi.fn().mockResolvedValue({ error: null });
		const eq = vi.fn().mockReturnValue({ is: isNull });
		const update = vi.fn().mockReturnValue({ eq });
		mock.client.mockReturnValue({ schema: () => ({ from: () => ({ update }) }) });
		await recordReceiptDelivery('payment-id', channel);
		expect(update).toHaveBeenCalledWith({ [field]: expect.any(String) });
		expect(eq).toHaveBeenCalledWith('id', 'payment-id');
		expect(isNull).toHaveBeenCalledWith(field, null);
	});
	it('記録障害は送信済みメールや決済を失敗扱いにしない', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mock.client.mockImplementation(() => { throw new Error('database unavailable'); });
		await expect(recordReceiptDelivery('payment-id', 'email')).resolves.toBeUndefined();
	});
});
