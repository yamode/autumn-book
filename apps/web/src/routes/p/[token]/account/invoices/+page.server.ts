import { listPartnerInvoices, partnerInvoiceFacilityNames } from '$lib/server/partners/invoices';
import { listAdvanceInvoices } from '$lib/server/partners/advance-invoices';
import { advanceInvoiceStateOf, ADVANCE_INVOICE_STATE_LABEL } from '$lib/partner-advance-invoice';
import { portalHeader, PORTAL_HEADERS, requirePortalSession } from '$lib/server/partners/portal';
import { todayJst } from '$lib/server/partners/store';

// 取引先専用ページ: アカウント → ご請求書（月次のご利用明細書＋ご請求書（適格請求書）。2026-10-01 追加）。
// マスタ・子ユーザーとも閲覧できる。取引先に見せるのは発行済み（status = 'issued'）だけ（取消済みは出さない）。
// 前受金のご請求書（銀行振込の事前支払・2026-10-28 docs/partner-prepayment.md §5）も別の節に並べる。
// 取り消した前受金のご請求書は、同じ予約に有効な1枚が無いときだけ「取消」として出す（作り直した後は新しい方だけ）。
export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  const [rows, advanceRows] = await Promise.all([listPartnerInvoices(db, partner.id), listAdvanceInvoices(db, partner.id)]);
  const invoices = rows
    .filter((r) => r.status === 'issued')
    .map((r) => ({
      id: r.id,
      period: r.period,
      invoiceNo: r.invoice_no,
      issueDate: r.issue_date,
      dueDate: r.due_date,
      billedTotal: r.billed_total,
      usageTotal: r.usage_total,
      // 載っている施設（全施設分1枚・2026-10-09 N3）。行に小さく出す
      facilityNames: partnerInvoiceFacilityNames(r)
    }));

  // 前受金: 入金済みかは台帳の payment_status（取引先の予約だけを partner_id で絞って読む）
  const bookingIds = [...new Set(advanceRows.map((r) => r.booking_id))];
  const bookingState = new Map<string, { status: string; payment_status: string }>();
  if (bookingIds.length) {
    const { data } = await db.from('rms_partner_bookings').select('id, status, payment_status').eq('partner_id', partner.id).in('id', bookingIds);
    for (const b of (data ?? []) as { id: string; status: string; payment_status: string }[]) bookingState.set(b.id, b);
  }
  const issuedFor = new Set(advanceRows.filter((r) => r.status === 'issued').map((r) => r.booking_id));
  const today = todayJst();
  const advanceInvoices = advanceRows
    .filter((r) => r.status === 'issued' || !issuedFor.has(r.booking_id))
    // 同じ予約の取消済みが複数あるときは新しい1枚だけ
    .filter((r, i, all) => r.status === 'issued' || all.findIndex((x) => x.booking_id === r.booking_id) === i)
    .map((r) => {
      const state = advanceInvoiceStateOf(r, bookingState.get(r.booking_id) ?? null, today);
      return {
        id: r.id,
        invoiceNo: r.invoice_no,
        bookingCode: r.document?.booking?.bookingCode ?? '',
        facilityName: r.document?.booking?.facilityName ?? '',
        checkIn: r.document?.booking?.checkIn ?? '',
        issueDate: r.issue_date,
        dueDate: r.due_date,
        amount: r.amount,
        partial: !!r.document?.amounts?.partial,
        state,
        stateLabel: ADVANCE_INVOICE_STATE_LABEL[state],
        // 取り消した請求書・取り消した予約の請求書は取引先にはダウンロードさせない（月次と同じ・振込の取り違えを防ぐ）
        downloadable: r.status === 'issued' && state !== 'booking_cancelled'
      };
    });
  return {
    portal: portalHeader(partner, session),
    invoices,
    advanceInvoices
  };
};
