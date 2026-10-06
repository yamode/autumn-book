// オンライン決済の予約（同じ画面で払う方式・v0.42.0〜）: 予約画面の確定ボタン（または Apple Pay / Google Pay）から呼ぶ。
// 予約を仮押さえ（pending_payment・35分）し、PaymentIntent / SetupIntent を作って client_secret を返す。
// ブラウザはこの client_secret で stripe.confirmPayment / confirmSetup を行い、終わったら /payment（confirm）へ連絡する。
// 送るのは予約画面のフォームそのもの（FormData・同一オリジン）。後払いは従来どおり form action（/book の default）。
import { error, json } from '@sveltejs/kit';
import { isStripePaymentOption } from '$lib/partner-booking';
import { availablePaymentOptions, createPartnerBooking } from '$lib/server/partners/booking';
import { parseBookingForm } from '$lib/server/partners/booking-form';
import { PORTAL_HEADERS, requestMeta, requirePortalApi } from '$lib/server/partners/portal';
import { PartnerStoreError } from '$lib/server/partners/store';

export const POST = async (event) => {
  const { db, partner, session } = await requirePortalApi(event);
  const input = parseBookingForm(await event.request.formData());
  const payIds = availablePaymentOptions(partner);
  const option = payIds.length === 1 ? payIds[0] : input.paymentOption;
  if (!isStripePaymentOption(option) || !payIds.includes(option)) throw error(400, 'オンライン決済の予約ではありません。');
  try {
    const created = await createPartnerBooking(db, partner, { id: session.id, login_id: session.login_id }, { ...input, paymentOption: option }, {
      ip: requestMeta(event).ip,
      origin: event.url.origin
    });
    if (!created.payment) throw new PartnerStoreError('お支払いの準備ができませんでした。', 502);
    return json(
      { ok: true, payment: created.payment, returnUrl: `${event.url.origin}/p/${event.params.token}/bookings` },
      { headers: PORTAL_HEADERS }
    );
  } catch (e) {
    if (e instanceof PartnerStoreError) return json({ ok: false, message: e.message }, { status: e.status >= 400 && e.status < 600 ? e.status : 400, headers: PORTAL_HEADERS });
    throw e;
  }
};
