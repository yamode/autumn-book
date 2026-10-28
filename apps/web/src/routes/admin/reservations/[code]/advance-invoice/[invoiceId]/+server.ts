// 予約管理の詳細（取引先予約）: 前受金のご請求書のダウンロード（GET ?format=pdf|html）。2026-10-28（docs/partner-prepayment.md §5）。
// 閲覧の権限（admin / staff）で開ける。staffPartnerScope（役割・施設へのアクセス権）→ いま選んでいる施設の台帳にこの予約があるか
// → 請求書がその取引先・その予約のものか、の順に確かめる（partnerAdvanceInvoiceDownload）。PDF が作れない環境では HTML（印刷用）。
import { error } from '@sveltejs/kit';
import { partnerAdvanceInvoiceDownload } from '$lib/server/partners/admin-reservations';
import { PartnerStoreError } from '$lib/server/partners/store';
import { StaffScopeError } from '$lib/server/partners/staff';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const format = event.url.searchParams.get('format') === 'html' ? 'html' : 'pdf';
		return await partnerAdvanceInvoiceDownload(event, event.params.code, event.params.invoiceId, format);
	} catch (e) {
		if (e instanceof StaffScopeError || e instanceof PartnerStoreError) error(e.status >= 400 && e.status < 600 ? e.status : 400, e.message);
		throw e;
	}
};
