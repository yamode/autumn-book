// 予約画面の料金・残室の再計算（泊数・室数・人数を変えたとき）。確定時にサーバでもう一度計算し直す。
import { error, json } from '@sveltejs/kit';
import { canBookFor } from '$lib/partner-booking';
import { quotePartnerBooking } from '$lib/server/partners/booking';
import { PORTAL_HEADERS, resolvePortal } from '$lib/server/partners/portal';
import { partnerUnavailableReason } from '$lib/server/partners/store';

export const POST = async (event) => {
  const { db, partner, session } = await resolvePortal(event);
  if (!session) throw error(401, 'ログインしてください。');
  if (partnerUnavailableReason(partner) || !partner.booking_enabled) throw error(403, '現在ご予約を受け付けていません。');
  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
  const rooms = Array.isArray(body.rooms) ? body.rooms.slice(0, 20).map((r) => ({ adults: Math.round(Number((r as { adults?: unknown })?.adults)) || 0 })) : [];
  const checkIn = String(body.checkIn ?? '');
  const quote = await quotePartnerBooking(db, partner, {
    roomCode: String(body.roomCode ?? ''),
    planCode: String(body.planCode ?? ''),
    planName: String(body.planName ?? ''),
    checkIn,
    nights: Math.round(Number(body.nights)) || 1,
    rooms
  });
  return json({ quote, canBook: /^\d{4}-\d{2}-\d{2}$/.test(checkIn) && canBookFor(checkIn, partner.booking_settings) }, { headers: PORTAL_HEADERS });
};
