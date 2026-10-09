// 管理画面: 取引先の請求書（利用明細書＋適格請求書）のダウンロード（/admin/partners/[id]/invoices/[invoiceId]?format=pdf|html）。
// 閲覧権限（admin / staff）で開ける。staffPartnerScope（役割・施設・施設へのアクセス権）→ requireInvoicePartner（取引先が同じ会社のものか）
// → getPartnerInvoice（請求書がその取引先のものか）の順に確かめる。PDF が作れない環境では HTML（印刷用）を返す。
// 2026-10-09（全施設分1枚・N3）: 請求書は取引先ごと（施設をまたぐ）なので、施設ごとの請求書（version 1）も含めて開ける。
import { error } from '@sveltejs/kit';
import { getPartnerInvoice, invoiceDownloadResponse, requireInvoicePartner } from '$lib/server/partners/invoices';
import { PartnerStoreError } from '$lib/server/partners/store';
import { staffPartnerScope, StaffScopeError } from '$lib/server/partners/staff';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const scope = await staffPartnerScope(event, 'view');
		const partner = await requireInvoicePartner(scope.db, scope, event.params.id);
		const row = await getPartnerInvoice(scope.db, partner.id, event.params.invoiceId);
		if (!row) error(404, '請求書が見つかりません。');
		const format = event.url.searchParams.get('format') === 'html' ? 'html' : 'pdf';
		return await invoiceDownloadResponse(row, format);
	} catch (e) {
		if (e instanceof StaffScopeError || e instanceof PartnerStoreError) error(e.status, e.message);
		throw e;
	}
};
