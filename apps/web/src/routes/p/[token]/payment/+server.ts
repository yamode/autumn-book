// 取引先ページの決済 API（同じ画面で払う方式・v0.42.0〜）。POST JSON { action, ... }
//   prepare … 既にある予約（予約一覧の「お支払いへ進む」「カードの登録へ進む」「カードを登録し直す」）の Intent を用意する
//             { bookingId } → { payment: { mode, clientSecret, amount, consentText, ... }, returnUrl }
//   confirm … ブラウザで Stripe の確定が終わった連絡。Intent を Stripe から取り直して確かめ、予約を確定する
//             { intentId } → { result: PaymentResult }（Webhook と同じ処理・冪等）
//   release … 予約画面で支払前に仮押さえをやめる（入力に戻るとき）{ bookingId }
// どれもログイン中の取引先の予約だけを扱う（別の取引先の予約 id・Intent は unknown / 404）。
import { error, json } from '@sveltejs/kit';
import { confirmPartnerIntent, releasePendingBooking, resumePartnerPayment } from '$lib/server/partners/booking';
import { PORTAL_HEADERS, requirePortalApi } from '$lib/server/partners/portal';
import { PartnerStoreError } from '$lib/server/partners/store';
import { isPaymentIntentId, isSetupIntentId } from '$lib/server/payments/verify';
import { StripeError } from '$lib/server/stripe';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = async (event) => {
  const { db, partner } = await requirePortalApi(event);
  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');
  const bookingId = String(body.bookingId ?? '');
  const intentId = String(body.intentId ?? '');
  const reply = (data: unknown, status = 200) => json(data, { status, headers: PORTAL_HEADERS });
  try {
    if (action === 'prepare') {
      if (!UUID.test(bookingId)) throw error(400, '予約の指定が正しくありません。');
      const payment = await resumePartnerPayment(db, partner, bookingId);
      return reply({ ok: true, payment, returnUrl: `${event.url.origin}/p/${event.params.token}/bookings` });
    }
    if (action === 'confirm') {
      if (!isPaymentIntentId(intentId) && !isSetupIntentId(intentId)) throw error(400, '決済の指定が正しくありません。');
      const result = await confirmPartnerIntent(db, intentId, event.url.origin, partner.id);
      return reply({ ok: true, result });
    }
    if (action === 'release') {
      if (!UUID.test(bookingId)) throw error(400, '予約の指定が正しくありません。');
      return reply({ ok: true, released: await releasePendingBooking(db, partner, bookingId) });
    }
    throw error(400, '不明な操作です。');
  } catch (e) {
    if (e instanceof PartnerStoreError) return reply({ ok: false, message: e.message }, e.status >= 400 && e.status < 600 ? e.status : 400);
    if (e instanceof StripeError) return reply({ ok: false, message: 'お支払いの準備ができませんでした。時間をおいてお試しください。' }, 502);
    throw e;
  }
};
