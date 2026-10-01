// 管理画面: 取引先の請求書（利用明細書＋適格請求書）のダウンロード（/admin/partners/[id]/invoices/[invoiceId]?format=pdf|html）。
// 閲覧権限（admin / staff）で開ける。staffPartnerScope（役割・施設・施設へのアクセス権）→ requireStaffPartner（取引先がその施設のものか）
// → getPartnerInvoice（請求書がその取引先のものか）の順に確かめる。PDF が作れない環境では HTML（印刷用）を返す。
import { error } from '@sveltejs/kit';
import { getPartnerInvoice, invoiceDownloadResponse } from '$lib/server/partners/invoices';
import { PartnerStoreError, requireStaffPartner } from '$lib/server/partners/store';
import { staffPartnerScope, StaffScopeError } from '$lib/server/partners/staff';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const scope = await staffPartnerScope(event, 'view');
		const partner = await requireStaffPartner(scope.db, scope.facilityId, event.params.id);
		const row = await getPartnerInvoice(scope.db, partner.id, event.params.invoiceId);
		if (!row || row.facility_id !== scope.facilityId) error(404, '請求書が見つかりません。');
		const format = event.url.searchParams.get('format') === 'html' ? 'html' : 'pdf';
		return await invoiceDownloadResponse(row, format);
	} catch (e) {
		if (e instanceof StaffScopeError || e instanceof PartnerStoreError) error(e.status, e.message);
		throw e;
	}
};
