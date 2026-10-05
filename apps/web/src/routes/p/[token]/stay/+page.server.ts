import { redirect } from '@sveltejs/kit';
import { logPartnerAccess, partnerUnavailableReason, todayJst } from '$lib/server/partners/store';
import { loadPartnerContents } from '$lib/server/partners/contents';
import { isPartnerBookingOpen } from '$lib/server/partners/booking';
import { portalHeader, PORTAL_HEADERS, requestMeta, resolvePortal } from '$lib/server/partners/portal';

// 取引先専用ページ: お部屋とプラン（一休型）。日程・泊数・人数を選ぶと、部屋タイプごとの全幅カードに
// その日程で予約できるプランと料金を並べる。料金・空室は料金カレンダーと同じ月の JSON を画面側で読む。
export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await resolvePortal(event);
  const token = event.params.token;
  if (!session) throw redirect(303, `/p/${token}`);
  if (partnerUnavailableReason(partner)) throw redirect(303, `/p/${token}`);

  const q = event.url.searchParams;
  const s = partner.booking_settings;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') ?? '') ? (q.get('date') as string) : '';
  const nights = Math.min(s.maxNights, Math.max(1, Math.round(Number(q.get('nights') ?? 1)) || 1));
  const guestsRaw = Math.round(Number(q.get('guests') ?? 2));
  const guests = guestsRaw >= 1 && guestsRaw <= 6 ? guestsRaw : 2;

  const [contents] = await Promise.all([
    // 写真・紹介（読めなくても一覧は出す）
    loadPartnerContents(db, partner).catch(() => ({ rooms: [], plans: [] })),
    logPartnerAccess(db, {
      partnerId: partner.id,
      accountId: session.id,
      channel: 'web',
      action: 'view',
      detail: { page: 'stay', date, nights, guests },
      ip: requestMeta(event).ip
    })
  ]);

  return {
    portal: portalHeader(partner, session),
    today: todayJst(),
    params: { date, nights, guests },
    showInventory: partner.show_inventory,
    planNames: s.planNames,
    booking: { enabled: isPartnerBookingOpen(partner), leadDays: s.leadDays, cutoffHour: s.cutoffHour, maxNights: s.maxNights },
    rooms: contents.rooms,
    // プランの紹介（プランのご紹介ページの位置へのリンク用）
    planAnchors: contents.plans.map((p) => ({ planCode: p.planCode, planLabel: p.planLabel, anchor: p.anchor })),
    // 専用特典の付くプラン（「専用特典」のしるし用。全プラン対象の特典があれば全部に付く）
    perkPlanCodes: [...new Set(s.perks.flatMap((p) => p.planCodes))],
    commonPerk: s.perks.some((p) => !p.planCodes.length)
  };
};
