import { fail, redirect } from '@sveltejs/kit';
import { canBookFor, describeDeadline, PARTNER_PAYMENT_OPTIONS } from '$lib/partner-booking';
import { availablePaymentOptions, createPartnerBooking, isPartnerBookingOpen, quotePartnerBooking } from '$lib/server/partners/booking';
import { PartnerStoreError, todayJst } from '$lib/server/partners/store';
import { portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

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
    paymentOptions: PARTNER_PAYMENT_OPTIONS.filter((o) => payIds.includes(o.id))
  };
};

export const actions = {
  default: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    const fd = await event.request.formData();
    const roomCount = Math.min(20, Math.max(1, Math.round(Number(str(fd, 'room_count'))) || 1));
    const rooms = Array.from({ length: roomCount }, (_, i) => ({ adults: Math.round(Number(str(fd, `adults_${i}`))) || 0 }));
    const answers: Record<string, string> = {};
    for (const o of partner.booking_settings.options) answers[o.id] = str(fd, `opt_${o.id}`);
    try {
      const created = await createPartnerBooking(
        db,
        partner,
        { id: session.id, login_id: session.login_id },
        {
          roomCode: str(fd, 'room_code'),
          planCode: str(fd, 'plan_code'),
          planName: str(fd, 'plan_name'),
          checkIn: str(fd, 'check_in'),
          nights: Math.round(Number(str(fd, 'nights'))) || 1,
          rooms,
          guest: {
            familyName: str(fd, 'family_name'),
            givenName: str(fd, 'given_name'),
            familyNameKana: str(fd, 'family_name_kana'),
            givenNameKana: str(fd, 'given_name_kana'),
            phone: str(fd, 'phone'),
            email: str(fd, 'email'),
            zipCode: str(fd, 'zip_code'),
            address: str(fd, 'address'),
            allergies: str(fd, 'allergies')
          },
          arrival: str(fd, 'arrival'),
          notes: str(fd, 'notes'),
          answers,
          paymentOption: str(fd, 'payment_option')
        },
        { ip: requestMeta(event).ip, origin: event.url.origin }
      );
      // オンライン決済は Stripe の決済画面へ（支払完了で予約確定・PMS へ）
      if (created.checkoutUrl) throw redirect(303, created.checkoutUrl);
      throw redirect(303, `/p/${event.params.token}/bookings?done=${encodeURIComponent(created.bookingCode)}`);
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(e.status >= 400 && e.status < 600 ? e.status : 400, { message: e.message });
      throw e;
    }
  }
};
