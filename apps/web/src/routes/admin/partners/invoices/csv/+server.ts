// 管理画面: 予定請求の施設別小計の CSV（/admin/partners/invoices/csv?period=YYYY-MM[&all=1]）。2026-10-09 全施設分1枚（N3）・M5。
// freee の入金登録で、取引先からの1回の振込を施設（部門）ごとの売掛に分けて消し込むための手元資料。
// 1行 = 取引先 × 施設（期間・取引先・施設・10%対象（税込）・入湯税・キャンセル料・ご請求額）。ご請求額 0 円の施設も出す。
// 対象の取引先は一覧（/admin/partners/invoices）と同じ（既定は今の施設に関わる取引先・all=1 で全取引先）。金額は常に全施設分。
// 閲覧権限（admin / staff）で開ける。
import { error } from '@sveltejs/kit';
import { invoiceFacilityCsv, periodOf, type InvoiceFacilityCsvRow } from '$lib/partner-invoice';
import { contentDisposition, normalizePeriod, previewTenantInvoices } from '$lib/server/partners/invoices';
import { PartnerStoreError, todayJst } from '$lib/server/partners/store';
import { staffPartnerScope, StaffScopeError } from '$lib/server/partners/staff';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const scope = await staffPartnerScope(event, 'view');
		const currentPeriod = periodOf(todayJst());
		const raw = event.url.searchParams.get('period');
		const period = raw ? normalizePeriod(raw) : currentPeriod;
		if (!period) error(400, '対象月が正しくありません。');
		if (period > currentPeriod) error(400, 'これからの月は出力できません。');
		const all = event.url.searchParams.get('all') === '1';
		const { rows } = await previewTenantInvoices(scope.db, { tenantId: scope.tenantId, facilityId: scope.facilityId }, period, { all });
		const csvRows: InvoiceFacilityCsvRow[] = rows.flatMap((r) =>
			r.document.facilities.map((f) => ({
				period,
				partnerName: r.partner.name,
				facilityName: f.name,
				taxable10: f.totals.taxable10,
				nonTaxable: f.totals.nonTaxable,
				cancelFee: f.totals.cancelFee,
				billedTotal: f.totals.billedTotal
			}))
		);
		const fileName = `取引先請求_施設別小計_${period.slice(0, 7)}${all ? '_全取引先' : ''}.csv`;
		return new Response(invoiceFacilityCsv(csvRows), {
			headers: {
				'content-type': 'text/csv; charset=utf-8',
				'content-disposition': contentDisposition('attachment', fileName),
				'cache-control': 'private, no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		if (e instanceof StaffScopeError || e instanceof PartnerStoreError) error(e.status, e.message);
		throw e;
	}
};
