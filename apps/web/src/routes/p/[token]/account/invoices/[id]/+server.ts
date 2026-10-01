import { error } from '@sveltejs/kit';
import { getPartnerInvoice, invoiceDownloadResponse } from '$lib/server/partners/invoices';
import { PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';
import { logPartnerAccess } from '$lib/server/partners/store';

// 取引先専用ページ: 請求書のダウンロード（GET ?format=pdf|html）。2026-10-01 追加。
// セッションで確かめた取引先（partner.id）の請求書だけを読む（別の取引先の ID を渡されても見つからない扱い）。
// 発行済み（issued）だけ。取消済み（void）は取引先には出さない。
export const GET = async (event) => {
  const { db, partner, session } = await requirePortalSession(event);
  const id = event.params.id ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw error(404, 'ご請求書が見つかりません。');
  const format = event.url.searchParams.get('format') === 'html' ? 'html' : 'pdf';
  const row = await getPartnerInvoice(db, partner.id, id);
  if (!row || row.status !== 'issued') throw error(404, 'ご請求書が見つかりません。');
  await logPartnerAccess(db, {
    partnerId: partner.id,
    accountId: session.id,
    channel: 'web',
    action: 'invoice_download',
    detail: { invoiceId: row.id, invoiceNo: row.invoice_no, format },
    ip: requestMeta(event).ip
  });
  return invoiceDownloadResponse(row, format, PORTAL_HEADERS);
};
