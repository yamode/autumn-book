import { fail, redirect } from '@sveltejs/kit';
import { canBookFor, describeDeadline, isStripePaymentOption, PARTNER_PAYMENT_OPTIONS } from '$lib/partner-booking';
import { availablePaymentOptions, createPartnerBooking, isPartnerBookingOpen, quotePartnerBooking } from '$lib/server/partners/booking';
import { parseBookingForm } from '$lib/server/partners/booking-form';
import { PartnerStoreError, todayJst } from '$lib/server/partners/store';
import { portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';
import { stripePublishableKey } from '$lib/server/stripe';

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  const token = event.params.token;
  if (!isPartnerBookingOpen(partner)) throw redirect(303, `/p/${token}/calendar`);

  const q = event.url.searchParams;
  const roomCode = q.get('room') ?? '';
  const planCode = q.get('plan') ?? '';
  const planName = q.get('name') ?? '';
  const checkIn = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') ?? '') ? (q.get('date') as string) : todayJst();
  const guests = Math.min(20, Math.max(1, Math.round(Number(q.get('guests') ?? 2)) || 2));
  if (!roomCode || !planCode) throw redirect(303, `/p/${token}/calendar`);

  const s = partner.booking_settings;
  const [quote, rt] = await Promise.all([
    quotePartnerBooking(db, partner, { roomCode, planCode, planName, checkIn, nights: 1, rooms: [{ adults: guests }] }),
    db.schema('pms').from('room_types').select('capacity_min, capacity_max').eq('facility_id', partner.facility_id).eq('code', roomCode).maybeSingle()
  ]);
  const payIds = availablePaymentOptions(partner);

  return {
    portal: portalHeader(partner, session),
    target: { roomCode, planCode, planName, checkIn, guests },
    quote,
    canBook: canBookFor(checkIn, s),
    deadlineText: describeDeadline(s.leadDays, s.cutoffHour),
    cancelText: s.cancelDays == null ? null : describeDeadline(s.cancelDays, s.cutoffHour),
    capacity: { min: Number(rt.data?.capacity_min ?? 1) || 1, max: Number(rt.data?.capacity_max ?? 6) || 6 },
    settings: { maxRooms: s.maxRooms, maxNights: s.maxNights, notice: s.notice, options: s.options },
    paymentOptions: PARTNER_PAYMENT_OPTIONS.filter((o) => payIds.includes(o.id)),
    // 同じ画面で払う決済部品に渡す公開可能キー（オンライン決済を出せないときは null）
    stripeKey: payIds.some(isStripePaymentOption) ? stripePublishableKey() : null
  };
};

// 後払い（銀行振込等）の確定。オンライン決済は同じ画面で払うため /book/reserve（API）から確定する。
export const actions = {
  default: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    const input = parseBookingForm(await event.request.formData(), partner.booking_settings.options.map((o) => o.id));
    // 支払方法が1つだけならそれに決まる（createPartnerBooking と同じ規則）
    const payIds = availablePaymentOptions(partner);
    const option = payIds.length === 1 ? payIds[0] : input.paymentOption;
    if (isStripePaymentOption(option)) return fail(400, { message: 'お支払い情報を入力してから予約してください。' });
    try {
      const created = await createPartnerBooking(db, partner, { id: session.id, login_id: session.login_id }, input, {
        ip: requestMeta(event).ip,
        origin: event.url.origin
      });
      throw redirect(303, `/p/${event.params.token}/bookings?done=${encodeURIComponent(created.bookingCode)}`);
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(e.status >= 400 && e.status < 600 ? e.status : 400, { message: e.message });
      throw e;
    }
  }
};
