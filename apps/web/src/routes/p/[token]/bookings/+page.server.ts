import { fail } from '@sveltejs/kit';
import { canPartnerCancel, describeDeadline } from '$lib/partner-booking';
import {
  cancelPartnerBooking,
  canUpdateCard,
  cardConsentText,
  confirmPartnerIntent,
  listPartnerBookings,
  type PaymentResult
} from '$lib/server/partners/booking';
import { readBookingExtras, splitExtraOptions } from '$lib/server/partners/booking-extras';
import { PartnerStoreError } from '$lib/server/partners/store';
import { portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';
import { isPaymentIntentId, isSetupIntentId } from '$lib/server/payments/verify';
import { stripePublishableKey } from '$lib/server/stripe';

// 予約画面・支払の再開から戻ったときに出す結果（ブラウザが確定の連絡を済ませた後。表示だけに使う）
const RESULT_STATUSES = new Set<PaymentResult['status']>(['paid', 'already', 'unpaid', 'refunded_late', 'card_saved', 'card_updated', 'card_late']);

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  let payment: PaymentResult | { status: 'error'; message: string } | null = null;
  const q = event.url.searchParams;
  // Stripe の本人認証でリダイレクトした決済手段の戻り（?payment_intent= / ?setup_intent=。カードは通常モーダルで済み、ここへは来ない）:
  // 支払完了を確かめて予約を確定する（Webhook より先に戻ってきても確定できるように・冪等）
  const returned = q.get('payment_intent') ?? q.get('setup_intent') ?? '';
  if (isPaymentIntentId(returned) || isSetupIntentId(returned)) {
    payment = await confirmPartnerIntent(db, returned, event.url.origin, partner.id).catch((e) => ({
      status: 'error' as const,
      message: e instanceof Error ? e.message : String(e)
    }));
    if (payment.status === 'unknown') payment = { status: 'unpaid' };
  } else if (q.get('result')) {
    // 同じ画面で確定まで済ませて来たとき（?code=&result=）
    const r = q.get('result') as PaymentResult['status'];
    payment = { status: RESULT_STATUSES.has(r) ? r : 'unpaid', bookingCode: q.get('code') ?? undefined };
    if (r === 'card_updated' && q.get('charge')) payment.charge = { status: q.get('charge') === 'paid' ? 'paid' : 'failed', message: '' };
  }
  const rows = await listPartnerBookings(db, { partnerId: partner.id, limit: 300 });
  const s = partner.booking_settings;
  return {
    portal: portalHeader(partner, session),
    done: q.get('done'),
    payment,
    // 同じ画面で払う決済部品（支払の再開・カードの登録し直し）に渡す公開可能キー。オンライン決済を出せないときは null
    stripeKey: stripePublishableKey(),
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
      // 支払の再開・カード登録のときの決済部品の種類（予約時決済 = payment / チェックイン日決済 = setup）
      payMode: b.payment_option === 'online_checkin' ? ('setup' as const) : b.payment_option === 'online' ? ('payment' as const) : null,
      // カード登録の同意文（入力欄の直下に出し、登録完了時に同じ文面を記録する）
      consentText: b.payment_option === 'online_checkin' ? cardConsentText(partner.facility_name, b) : null,
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
      // 予約者（ご担当者）・交通手段・取引先特典（2026-10-01〜の予約だけ。無ければ画面に出さない）
      ...readBookingExtras(b.detail),
      // 入力項目の一覧（旧形式の「予約時決済割引」の行は料金の明細へ、予約者・交通手段・特典の行は上の項目へ移すので外す）
      options: splitExtraOptions(b.detail).filter((o) => o.label !== PREPAY_DISCOUNT_LABEL),
      ...priceOf(b),
      notes: b.detail.notes ?? '',
      paymentMethodName: b.payment_method_name,
      bookedBy: b.booked_by,
      createdAt: b.created_at,
      cancelledAt: b.cancelled_at,
      cancelledBy: b.cancelled_by
    }))
  };
};

const PREPAY_DISCOUNT_LABEL = '予約時決済割引';
// 料金の明細: 宿泊料金（割引前）・予約時決済割引・入湯税・合計（請求額）。
// 2026-09-26 以降の予約は割引を prepay_discount_amount に持ち total_amount は割引前。
// それより前の予約は total_amount が割引後で、割引は入力項目（'2%引き（-2,304円）'）にだけ残っているので、そこから戻す。
function priceOf(b: {
  total_amount: number;
  bath_tax_amount: number | null;
  prepay_discount_amount?: number | null;
  detail: { options?: { label: string; value: string }[] };
}) {
  const bathTax = b.bath_tax_amount ?? 0;
  const o = (b.detail.options ?? []).find((x) => x.label === PREPAY_DISCOUNT_LABEL);
  const label = o ? o.value.replace(/[（(].*$/, '').trim() : '';
  const stored = b.prepay_discount_amount ?? 0;
  if (stored > 0) return { lodging: b.total_amount, discount: stored, discountLabel: label, bathTax, total: b.total_amount + bathTax - stored };
  const m = o?.value.match(/-([\d,]+)円/);
  const legacy = m ? Number(m[1].replace(/,/g, '')) : 0;
  return { lodging: b.total_amount + legacy, discount: legacy, discountLabel: label, bathTax, total: b.total_amount + bathTax };
}

export const actions = {
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
