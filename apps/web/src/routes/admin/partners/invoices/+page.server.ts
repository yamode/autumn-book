// 管理画面: 予定請求書の一覧（/admin/partners/invoices?period=YYYY-MM[&all=1]）。
// 2026-10-02 ユーザー指示: ご請求書の正式発行（送付）前に、取引先別に、その月の今日までの実績に基づいたご請求書を確認できる画面。
// 取引先ごとに、選んだ月（既定は当月・未来月は不可）の予定請求（チェックアウト済みの確定予約で計算）を並べる。
// 2026-10-09（全施設分1枚・N3／M4）: ご請求書は取引先ごとに全施設分を1枚にまとめる。既定は今の施設（ab_fac）に関わる取引先だけ、
//   「すべて」で会社の全取引先。金額は常に全施設分で、施設別の小計を列に出す（freee の入金消込用の CSV は ./csv）。
// 閲覧は admin / staff（staffPartnerScope 'view'）。ここでは発行・送信はしない（取引先の詳細画面で行う）。
import { periodOf } from '$lib/partner-invoice';
import { invoicePdfReady } from '$lib/server/partners/invoice-pdf';
import { normalizePeriod, previewTenantInvoices } from '$lib/server/partners/invoices';
import { PartnerStoreError, todayJst } from '$lib/server/partners/store';
import { staffPartnerScope, StaffScopeError } from '$lib/server/partners/staff';
import type { PageServerLoad } from './$types';

// 'YYYY-MM-01' の前後の月
function shiftPeriod(period: string, months: number): string {
	const [y, m] = period.split('-').map(Number);
	const d = new Date(Date.UTC(y, m - 1 + months, 1));
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const today = todayJst();
	const currentPeriod = periodOf(today);
	const raw = normalizePeriod(event.url.searchParams.get('period'));
	const period = raw && raw <= currentPeriod ? raw : currentPeriod;
	const all = event.url.searchParams.get('all') === '1';
	const base = {
		facilityName: currentFacility.name,
		today,
		period,
		currentPeriod,
		prevPeriod: shiftPeriod(period, -1),
		nextPeriod: period < currentPeriod ? shiftPeriod(period, 1) : null,
		pdfReady: invoicePdfReady(),
		all
	};
	try {
		const scope = await staffPartnerScope(event, 'view');
		const { settings, rows, hidden, facilities } = await previewTenantInvoices(scope.db, { tenantId: scope.tenantId, facilityId: scope.facilityId }, period, { all });
		// 施設別小計の列: Book の施設の並び（載っている施設が1つも無い列は出さない）
		const used = new Set(rows.flatMap((r) => r.document.facilities.map((f) => f.id)));
		const facilityColumns = facilities.filter((f) => used.has(f.id)).map((f) => ({ id: f.id, name: f.name }));
		return {
			...base,
			live: true,
			error: null as string | null,
			bankAccountMissing: !settings.bankAccount,
			issuerMissing: !settings.saved,
			autoIssue: settings.autoIssue,
			hidden,
			facilityColumns,
			rows: rows.map((r) => {
				const doc = r.document;
				return {
					partnerId: r.partner.id,
					partnerName: r.partner.name,
					recipientName: doc.recipient.name,
					bookingEnabled: r.partner.bookingEnabled,
					isActive: r.partner.isActive,
					total: doc.lines.length,
					billableCount: doc.lines.filter((l) => l.billable).length,
					usageTotal: doc.totals.usageTotal,
					billedTotal: doc.totals.billedTotal,
					tax10: doc.totals.tax10,
					nonTaxable: doc.totals.nonTaxable,
					cancelFee: doc.totals.cancelFee ?? 0,
					dueDate: doc.dueDate,
					// 施設ごとの小計（M3: 10%対象・入湯税・キャンセル料・ご請求額）。施設 id → 小計
					facilities: Object.fromEntries(
						doc.facilities.map((f) => [
							f.id,
							{ name: f.name, count: f.totals.count, taxable10: f.totals.taxable10, nonTaxable: f.totals.nonTaxable, cancelFee: f.totals.cancelFee, billedTotal: f.totals.billedTotal }
						])
					),
					chargeFailed: r.chargeFailed,
					issued: r.issued
						? {
								id: r.issued.id,
								invoiceNo: r.issued.invoice_no,
								issueDate: r.issued.issue_date,
								billedTotal: r.issued.billed_total,
								bookingCount: r.issued.booking_ids.length,
								issuedBy: r.issued.issued_by,
								sentAt: r.issued.sent_at,
								sentTo: r.issued.sent_to ?? [],
								sendError: r.issued.send_error,
								// 施設ごとの請求書（version 1）。1枚にまとめた発行は、取り消してから
								legacy: r.issued.legacy
							}
						: null
				};
			})
		};
	} catch (e) {
		if (e instanceof StaffScopeError || e instanceof PartnerStoreError) {
			const live = !(e instanceof StaffScopeError && (e.code === 'not_live' || e.code === 'service_unconfigured'));
			return {
				...base,
				live,
				error: e.message,
				bankAccountMissing: false,
				issuerMissing: false,
				autoIssue: true,
				hidden: 0,
				facilityColumns: [] as { id: string; name: string }[],
				rows: []
			};
		}
		throw e;
	}
};
