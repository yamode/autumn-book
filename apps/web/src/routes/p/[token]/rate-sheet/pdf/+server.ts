// 料金表の PDF（GET ?from=YYYY-MM&months=N&guests=2,3）。docs/partner-rank-rates.md §5.3。
// 紙面の HTML を Cloudflare Browser Rendering で PDF にする（請求書と同じ REST・環境変数）。
// 未設定・失敗なら印刷用 HTML（/rate-sheet/print・開くと印刷ダイアログ）へ 303 で切り替える。
// 未設定なら料金は読まずに入力の検査だけして切り替える（印刷用のページで読む）。
import { redirect } from '@sveltejs/kit';
import { renderRateSheetHtml } from '$lib/partner-rate-sheet';
import { contentDisposition } from '$lib/server/partners/invoices';
import { invoicePdfReady, renderHtmlPdf } from '$lib/server/partners/invoice-pdf';
import { loadRateSheetData, logRateSheet, parseRateSheetInput, rateSheetDownloadName } from '$lib/server/partners/rate-sheet';
import { PORTAL_HEADERS, requirePortalSession } from '$lib/server/partners/portal';
import { todayJst } from '$lib/server/partners/store';

export const GET = async (event) => {
  const { db, partner, session } = await requirePortalSession(event);
  const printUrl = `/p/${event.params.token}/rate-sheet/print${event.url.search}`;
  const guestsRaw = (event.url.searchParams.get('guests') ?? '').slice(0, 40);
  if (!invoicePdfReady()) {
    const req = parseRateSheetInput(partner, event.url);
    await logRateSheet(db, event, partner, session.id, 'rate_sheet_pdf', req, { guests: guestsRaw, format: 'html' });
    throw redirect(303, printUrl);
  }
  const data = await loadRateSheetData(db, partner, event.url);
  const pdf = await renderHtmlPdf(
    renderRateSheetHtml(data.sheet, {
      partnerName: partner.name,
      facilityName: partner.facility_name,
      issuedOn: todayJst(),
      months: data.req.monthList,
      range: data.req.range,
      guests: data.guests
    }),
    `rate-sheet ${partner.id} ${data.req.fromYm}+${data.req.months}`,
    { landscape: true }
  );
  await logRateSheet(db, event, partner, session.id, 'rate_sheet_pdf', data.req, { guests: data.guests, format: pdf ? 'pdf' : 'html' });
  if (!pdf) throw redirect(303, printUrl);
  return new Response(new Uint8Array(pdf), {
    headers: {
      ...PORTAL_HEADERS,
      'content-type': 'application/pdf',
      'content-length': String(pdf.byteLength),
      'content-disposition': contentDisposition('attachment', rateSheetDownloadName(partner, data.req, 'pdf')),
      'x-content-type-options': 'nosniff'
    }
  });
};
