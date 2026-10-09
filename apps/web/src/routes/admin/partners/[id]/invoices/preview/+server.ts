// 管理画面: 取引先の予定請求書（正式発行前の試算）の出力（/admin/partners/[id]/invoices/preview?period=YYYY-MM-01&format=html|pdf）。
// 2026-10-02 ユーザー指示: 正式発行（送付）前に、取引先別・その月の今日までの実績（チェックアウト済みの確定予約）でご請求書を確認する。
// 閲覧権限（admin / staff）で開ける。staffPartnerScope（役割・施設・施設へのアクセス権）→ requireInvoicePartner（取引先が同じ会社のものか）。
// 2026-10-09（全施設分1枚・N3）: 紙面は全施設分（施設が2つ以上なら施設の見出し・小計つき）。
// 紙面は previewPartnerInvoice の document を予定の表示（renderInvoiceHtml の draft）で出す。PDF が作れない環境では HTML（印刷用）を返す。
import { error } from '@sveltejs/kit';
import { periodOf } from '$lib/partner-invoice';
import { draftInvoiceResponse, normalizePeriod, previewPartnerInvoice, requireInvoicePartner } from '$lib/server/partners/invoices';
import { PartnerStoreError, todayJst } from '$lib/server/partners/store';
import { staffPartnerScope, StaffScopeError } from '$lib/server/partners/staff';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const scope = await staffPartnerScope(event, 'view');
		const partner = await requireInvoicePartner(scope.db, scope, event.params.id);
		const currentPeriod = periodOf(todayJst());
		const raw = event.url.searchParams.get('period');
		const period = raw ? normalizePeriod(raw) : currentPeriod;
		if (!period) error(400, '対象月が正しくありません。');
		if (period > currentPeriod) error(400, 'これからの月の予定請求書は作れません。');
		const format = event.url.searchParams.get('format') === 'pdf' ? 'pdf' : 'html';
		const { document } = await previewPartnerInvoice(scope.db, partner, period);
		return await draftInvoiceResponse(document, partner.name, format);
	} catch (e) {
		if (e instanceof StaffScopeError || e instanceof PartnerStoreError) error(e.status, e.message);
		throw e;
	}
};
