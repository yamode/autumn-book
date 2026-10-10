// 予約画面の料金・残室の再計算（泊数・室数・人数を変えたとき）。確定時にサーバでもう一度計算し直す。
import { error, json } from '@sveltejs/kit';
import { canBookFor } from '$lib/partner-booking';
import { quotePartnerBooking } from '$lib/server/partners/booking';
import { PORTAL_HEADERS, portalFacilityContext, resolvePortal } from '$lib/server/partners/portal';
import { partnerUnavailableReason, PartnerStoreError } from '$lib/server/partners/store';

export const POST = async (event) => {
  const { db, partner: selected, session } = await resolvePortal(event);
  if (!session) throw error(401, 'ログインしてください。');
  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
  // 見積の施設は予約画面の施設（facilityId・選んでいる施設ではない・§7.8）
  let partner;
  try {
    partner = await portalFacilityContext(db, selected, String(body.facilityId ?? ''));
  } catch (e) {
    if (e instanceof PartnerStoreError) throw error(e.status, e.message);
    throw e;
  }
  // 料金の再計算は読み取りなので確認モードも通す（公開停止中でも確認できるように）
  if ((partnerUnavailableReason(partner) && !session.preview) || !partner.booking_enabled) throw error(403, '現在ご予約を受け付けていません。');
  // 室数は団体予約の入力（/group/new・最大 100 室）からも使うので 100 まで受ける（個人予約の上限は確定時に maxRooms で見る）
  const rooms = Array.isArray(body.rooms) ? body.rooms.slice(0, 100).map((r) => ({ adults: Math.round(Number((r as { adults?: unknown })?.adults)) || 0 })) : [];
  const checkIn = String(body.checkIn ?? '');
  const quote = await quotePartnerBooking(db, partner, {
    roomCode: String(body.roomCode ?? ''),
    planCode: String(body.planCode ?? ''),
    planName: String(body.planName ?? ''),
    checkIn,
    nights: Math.round(Number(body.nights)) || 1,
    rooms
  }, { credit: true });
  return json({ quote, canBook: /^\d{4}-\d{2}-\d{2}$/.test(checkIn) && canBookFor(checkIn, partner.booking_settings) }, { headers: PORTAL_HEADERS });
};
