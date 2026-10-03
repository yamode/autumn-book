import { error } from '@sveltejs/kit';
import { perksForPlan } from '$lib/partner-booking';
import { logPartnerAccess } from '$lib/server/partners/store';
import { loadPartnerContents } from '$lib/server/partners/contents';
import { portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';

// 取引先専用ページ: プランの紹介。中身は autumn-book の紹介（公式サイトと共通）。
export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  let contents;
  try {
    contents = await loadPartnerContents(db, partner);
  } catch {
    throw error(503, '紹介を読み込めませんでした。時間をおいてお試しください。');
  }
  await logPartnerAccess(db, {
    partnerId: partner.id,
    accountId: session.id,
    channel: 'web',
    action: 'view',
    detail: { page: 'plans' },
    ip: requestMeta(event).ip
  });
  // 取引先特典: 全プラン対象（planCodes が空）はページ上部に1回だけ、プランを絞ったものは該当プランに出す
  const perks = partner.booking_settings.perks;
  const toView = (p: { id: string; title: string; description: string; imageUrl: string }) => ({ id: p.id, title: p.title, description: p.description, imageUrl: p.imageUrl });
  return {
    portal: portalHeader(partner, session),
    commonPerks: perks.filter((p) => !p.planCodes.length).map(toView),
    plans: contents.plans.map((p) => ({
      ...p,
      perks: perksForPlan(perks, p.planCode)
        .filter((k) => k.planCodes.length)
        .map(toView)
    }))
  };
};
