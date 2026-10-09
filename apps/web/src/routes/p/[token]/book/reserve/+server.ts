// オンライン決済の予約（同じ画面で払う方式・v0.42.0〜）: 予約画面の確定ボタン（または Apple Pay / Google Pay）から呼ぶ。
// 予約を仮押さえ（pending_payment・35分）し、PaymentIntent / SetupIntent を作って client_secret を返す。
// ブラウザはこの client_secret で stripe.confirmPayment / confirmSetup を行い、終わったら /payment（confirm）へ連絡する。
// 送るのは予約画面のフォームそのもの（FormData・同一オリジン）。後払いは従来どおり form action（/book の default）。
import { error, json } from '@sveltejs/kit';
import { isStripePaymentOption } from '$lib/partner-booking';
import { createPartnerBooking, resolvePaymentOption } from '$lib/server/partners/booking';
import { parseBookingForm } from '$lib/server/partners/booking-form';
import { portalAal2, portalFacilityContext, PORTAL_HEADERS, requestMeta, requirePortalApi } from '$lib/server/partners/portal';
import { PartnerStoreError } from '$lib/server/partners/store';

export const POST = async (event) => {
  const { db, partner: selected, session } = await requirePortalApi(event);
  const fd = await event.request.formData();
  const input = parseBookingForm(fd);
  try {
    // 予約する施設はフォームの施設（hidden facility_id・選んでいる施設ではない・§7.8）
    const partner = await portalFacilityContext(db, selected, String(fd.get('facility_id') ?? ''));
    // 選べる支払方法（受付枠を超えたときだけの online / deposit_online を含む・超過かは createPartnerBooking が確かめる）
    const option = resolvePaymentOption(partner, input.paymentOption)?.option ?? '';
    if (!isStripePaymentOption(option)) throw error(400, 'オンライン決済の予約ではありません。');
    const created = await createPartnerBooking(db, partner, { id: session.id, login_id: session.login_id }, { ...input, paymentOption: option }, {
      ip: requestMeta(event).ip,
      origin: event.url.origin,
      // 本人確認済み（aal2）のときだけ、保存カードを選べる Intent にする（docs/auth-hardening.md §5.2・S4）
      allowSavedCards: portalAal2(session)
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
