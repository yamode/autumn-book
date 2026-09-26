import { fail, redirect } from '@sveltejs/kit';
import { canPartnerCancel, describeDeadline } from '$lib/partner-booking';
import {
  cancelPartnerBooking,
  canUpdateCard,
  confirmOnlinePayment,
  listPartnerBookings,
  resumeOnlinePayment,
  type PaymentResult
} from '$lib/server/partners/booking';
import { PartnerStoreError } from '$lib/server/partners/store';
import { portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  // 決済画面からの戻り: 支払完了を確かめて予約を確定する（Webhook より先に戻ってきても確定できるように）
  let payment: PaymentResult | { status: 'error'; message: string } | null = null;
  // ?paid=（予約時決済の支払完了）/ ?card=（チェックイン日決済のカード登録完了）
  const paidSession = event.url.searchParams.get('paid') ?? event.url.searchParams.get('card');
  if (paidSession && /^cs_[A-Za-z0-9_]+$/.test(paidSession)) {
    payment = await confirmOnlinePayment(db, paidSession, event.url.origin).catch((e) => ({ status: 'error' as const, message: e instanceof Error ? e.message : String(e) }));
  }
  const rows = await listPartnerBookings(db, { partnerId: partner.id, limit: 300 });
  const s = partner.booking_settings;
  return {
    portal: portalHeader(partner, session),
    done: event.url.searchParams.get('done'),
    payment,
    unpaidId: event.url.searchParams.get('unpaid'),
    cancelText: s.cancelDays == null ? null : describeDeadline(s.cancelDays, s.cutoffHour),
    bookings: rows.map((b) => ({
      id: b.id,
      code: b.booking_code,
      status: b.status,
      checkedIn: !!b.checkedIn,
      canCancel: b.status === 'pending_payment' || (b.status === 'confirmed' && !b.checkedIn && canPartnerCancel(b.check_in_date, s)),
      paymentStatus: b.payment_status,
      paymentOption: b.payment_option,
      cardLabel: b.card_label,
      chargeError: b.charge_error,
      canUpdateCard: canUpdateCard(b),
      paymentExpiresAt: b.payment_expires_at,
      paidAmount: b.paid_amount,
      checkIn: b.check_in_date,
      checkOut: b.check_out_date,
      nights: b.nights,
      roomName: b.room_name ?? b.room_code ?? '',
      roomCount: b.room_count,
      planName: b.plan_name ?? '',
      mealType: b.meal_type,
      rooms: (b.detail.rooms ?? []).map((r) => r.adults),
      adultTotal: b.adult_total,
      guestName: b.guest_name,
      guestKana: b.guest_kana,
      phone: b.guest_phone,
      email: b.guest_email,
      address: [b.detail.guest?.zip_code, b.detail.guest?.address].filter(Boolean).join(' '),
      allergies: b.detail.guest?.allergies ?? '',
      arrival: b.detail.arrival ?? '',
      options: b.detail.options ?? [],
      notes: b.detail.notes ?? '',
      // 合計は入湯税を含む（宿泊料金＋入湯税）
      total: b.total_amount + (b.bath_tax_amount ?? 0),
      bathTax: b.bath_tax_amount ?? 0,
      paymentMethodName: b.payment_method_name,
      bookedBy: b.booked_by,
      createdAt: b.created_at,
      cancelledAt: b.cancelled_at,
      cancelledBy: b.cancelled_by
    }))
  };
};

export const actions = {
  // 支払待ちの予約の決済画面へ
  pay: async (event) => {
    const { db, partner } = await requirePortalSession(event);
    const fd = await event.request.formData();
    let url: string;
    try {
      url = await resumeOnlinePayment(db, partner, String(fd.get('id') ?? ''), event.url.origin);
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(400, { message: e.message });
      return fail(502, { message: 'お支払い画面を開けませんでした。時間をおいてお試しください。' });
    }
    throw redirect(303, url);
  },
  cancel: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    const fd = await event.request.formData();
    try {
      const b = await cancelPartnerBooking(db, partner, String(fd.get('id') ?? ''), 'partner', {
        reason: String(fd.get('reason') ?? ''),
        accountId: session.id,
        ip: requestMeta(event).ip,
        origin: event.url.origin
      });
      return { cancelled: b.booking_code };
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(400, { message: e.message });
      throw e;
    }
  }
};
