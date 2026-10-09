// 料金表の印刷用 HTML（PDF を作れないときの切り替え先・開くと印刷ダイアログ）。docs/partner-rank-rates.md §5.3。
// アクセスログは PDF の入口（/rate-sheet/pdf）で format=html として残すので、ここでは記録しない。
import { renderRateSheetHtml } from '$lib/partner-rate-sheet';
import { contentDisposition } from '$lib/server/partners/invoices';
import { loadRateSheetData, rateSheetDownloadName, rateSheetPrintCsp } from '$lib/server/partners/rate-sheet';
import { PORTAL_HEADERS, requirePortalSession } from '$lib/server/partners/portal';
import { todayJst } from '$lib/server/partners/store';

export const GET = async (event) => {
  const { db, partner } = await requirePortalSession(event);
  const data = await loadRateSheetData(db, partner, event.url);
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const html = renderRateSheetHtml(data.sheet, {
    partnerName: partner.name,
    facilityName: partner.facility_name,
    issuedOn: todayJst(),
    months: data.req.monthList,
    range: data.req.range,
    guests: data.guests,
    autoPrintNonce: nonce
  });
  return new Response(html, {
    headers: {
      ...PORTAL_HEADERS,
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': contentDisposition('inline', rateSheetDownloadName(partner, data.req, 'html')),
      'content-security-policy': rateSheetPrintCsp(nonce),
      'x-content-type-options': 'nosniff'
    }
  });
};
