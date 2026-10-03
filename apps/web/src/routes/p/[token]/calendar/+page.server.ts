import { redirect } from '@sveltejs/kit';
import { logPartnerAccess, partnerUnavailableReason } from '$lib/server/partners/store';
import { loadPortalMonth, parsePortalQuery } from '$lib/server/partners/portal-month';
import { isPartnerBookingOpen } from '$lib/server/partners/booking';
import { loadPartnerContents } from '$lib/server/partners/contents';
import { hasContent } from '$lib/partner-contents';
import { portalHeader, PORTAL_HEADERS, requestMeta, resolvePortal } from '$lib/server/partners/portal';

const pad = (n: number) => String(n).padStart(2, '0');

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await resolvePortal(event);
  if (!session) throw redirect(303, `/p/${event.params.token}`);
  const unavailable = partnerUnavailableReason(partner);
  if (unavailable) throw redirect(303, `/p/${event.params.token}`);

  const q = parsePortalQuery(event.url);
  const [initial, contents] = await Promise.all([
    loadPortalMonth(db, partner, q),
    // 紹介ページへのリンク用（読めなくてもカレンダーは出す）
    loadPartnerContents(db, partner).catch(() => ({ rooms: [], plans: [] })),
    logPartnerAccess(db, {
      partnerId: partner.id,
      accountId: session.id,
      channel: 'web',
      action: 'view',
      detail: { month: `${q.year}-${pad(q.month)}`, guests: q.guests },
      ip: requestMeta(event).ip
    })
  ]);

  return {
    portal: portalHeader(partner, session),
    showInventory: partner.show_inventory,
    // 取引先向けのプラン名（プランコード → 名前）
    planNames: partner.booking_settings.planNames,
    // 予約の受付（受付締切はカレンダーの「予約へ進む」の出し分けに使う。確定時にサーバで再確認する）
    booking: {
      enabled: isPartnerBookingOpen(partner),
      leadDays: partner.booking_settings.leadDays,
      cutoffHour: partner.booking_settings.cutoffHour
    },
    initial,
    // 紹介のある部屋コード・プランのページ内 ID（カレンダーから紹介へ飛ぶリンクを出す）
    introRooms: contents.rooms.filter(hasContent).map((r) => r.code),
    introPlans: contents.plans.map((p) => p.anchor)
  };
};
