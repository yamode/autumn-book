import { listPartnerInvoices } from '$lib/server/partners/invoices';
import { portalHeader, PORTAL_HEADERS, requirePortalSession } from '$lib/server/partners/portal';

// 取引先専用ページ: アカウント → ご請求書（月次のご利用明細書＋ご請求書（適格請求書）。2026-10-01 追加）。
// マスタ・子ユーザーとも閲覧できる。取引先に見せるのは発行済み（status = 'issued'）だけ（取消済みは出さない）。
export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  const rows = await listPartnerInvoices(db, partner.id);
  const invoices = rows
    .filter((r) => r.status === 'issued')
    .map((r) => ({
      id: r.id,
      period: r.period,
      invoiceNo: r.invoice_no,
      issueDate: r.issue_date,
      dueDate: r.due_date,
      billedTotal: r.billed_total,
      usageTotal: r.usage_total
    }));
  return {
    portal: portalHeader(partner, session),
    invoices
  };
};
