// 管理画面: 今後の請求予定の CSV（/admin/partners/charges/csv?…一覧と同じ絞り込み）。2026-10-10。
// 1行 = 予約1件（区分・請求予定日・予約番号・取引先・宿泊日・宿泊者・請求額・カード・取消日時・エラー）。
// 並びは画面と同じ（請求失敗 → キャンセル料 → 請求予定 → 最近の取消）。閲覧権限（admin / staff）で開ける。
import { error } from '@sveltejs/kit';
import { parseChargeRange, upcomingChargesCsv, type UpcomingCsvRow } from '$lib/partner-upcoming-charges';
import { contentDisposition } from '$lib/server/partners/invoices';
import { PartnerStoreError, todayJst } from '$lib/server/partners/store';
import { staffPartnerScope, StaffScopeError } from '$lib/server/partners/staff';
import { loadUpcomingCharges, type UpcomingChargeRow } from '$lib/server/partners/upcoming-charges';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const scope = await staffPartnerScope(event, 'view');
		const today = todayJst();
		const sp = event.url.searchParams;
		const range = parseChargeRange({ range: sp.get('range'), from: sp.get('from'), to: sp.get('to') }, today);
		const includeCancelled = sp.get('cancelled') === '1';
		const r = await loadUpcomingCharges(scope.db, { tenantId: scope.tenantId, facilityId: scope.facilityId }, { range, includeCancelled });
		const toCsv = (x: UpcomingChargeRow): UpcomingCsvRow => ({
			kind: x.kind,
			chargeOn: x.chargeOn,
			bookingCode: x.bookingCode,
			partnerName: x.partnerName,
			checkIn: x.checkIn,
			checkOut: x.checkOut,
			nights: x.nights,
			guestName: x.guestName,
			amount: x.amount,
			cardLabel: x.cardLabel,
			cancelledAt: x.cancelledAt,
			error: x.error
		});
		const rows = [...r.failed, ...r.cancelFees, ...r.scheduled, ...r.cancelled].map(toCsv);
		const span = range.from || range.to ? `_${range.from ?? ''}〜${range.to ?? ''}` : '';
		const fileName = `請求予定_${scope.facilityName}${span}_${today}.csv`;
		return new Response(upcomingChargesCsv(rows), {
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
