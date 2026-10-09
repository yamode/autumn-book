// 料金表の CSV（GET ?from=YYYY-MM&months=N）。docs/partner-rank-rates.md §5.3。確認モードでも出せる（GET のみ）。
import { rateSheetCsv } from '$lib/partner-rate-sheet';
import { contentDisposition } from '$lib/server/partners/invoices';
import { loadRateSheetData, logRateSheet, rateSheetDownloadName } from '$lib/server/partners/rate-sheet';
import { PORTAL_HEADERS, requirePortalSession } from '$lib/server/partners/portal';

export const GET = async (event) => {
  const { db, partner, session } = await requirePortalSession(event);
  const data = await loadRateSheetData(db, partner, event.url);
  const csv = rateSheetCsv(data.sheet, data.days, { facilityName: partner.facility_name, planNames: partner.booking_settings.planNames });
  await logRateSheet(db, event, partner, session.id, 'rate_sheet_csv', data.req);
  return new Response(csv, {
    headers: {
      ...PORTAL_HEADERS,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': contentDisposition('attachment', rateSheetDownloadName(partner, data.req, 'csv')),
      'x-content-type-options': 'nosniff'
    }
  });
};
