import { shiftYm } from '$lib/partner-rate-sheet';
import { clampPartnerRange, loadPartnerRates, partnerPublicBounds } from '$lib/server/partners/rates';
import { RATE_SHEET_DEFAULT_MAX_GUESTS } from '$lib/server/partners/rate-sheet';
import { addDaysIso, todayJst } from '$lib/server/partners/store';
import { portalHeader, PORTAL_HEADERS, requirePortalSession } from '$lib/server/partners/portal';

// 取引先専用ページ: 料金表（CSV / PDF）のダウンロード。docs/partner-rank-rates.md §5.3（2026-10-09）。
// 出力そのものは /rate-sheet/csv・/rate-sheet/pdf（GET）。確認モードでも使える（GET だけなので requirePortalSession が通す）。
export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  const today = todayJst();
  const bounds = partnerPublicBounds(partner, today);
  // 開始月の選択肢: 公開範囲にかかる月（今月〜公開の最終月）
  const months: string[] = [];
  if (partner.facility_available && bounds.earliest <= bounds.latest) {
    for (let ym = bounds.earliest.slice(0, 7); ym <= bounds.latest.slice(0, 7) && months.length < 25; ym = shiftYm(ym, 1)) months.push(ym);
  }
  // 人数の選択肢: 直近31日の料金に出ている人数（読めなければ 1〜6）
  let guestOptions = Array.from({ length: RATE_SHEET_DEFAULT_MAX_GUESTS }, (_, i) => i + 1);
  const near = partner.facility_available ? clampPartnerRange(partner, today, addDaysIso(today, 30), today) : null;
  if (near) {
    const seen = new Set<number>();
    try {
      const { days } = await loadPartnerRates(db, partner, near);
      for (const d of days) for (const r of d.rooms) for (const p of r.plans) for (const g of Object.keys(p.pricesPerPerson)) seen.add(Number(g));
      if (seen.size) guestOptions = Array.from({ length: Math.max(...seen) }, (_, i) => i + 1);
    } catch {
      // 読めなくても選べるようにする（出力のときに改めて読む）
    }
  }
  return {
    portal: portalHeader(partner, session),
    bounds,
    months,
    guestOptions
  };
};
