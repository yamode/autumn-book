// 取引先ページの決済 API（同じ画面で払う方式・v0.42.0〜）。POST JSON { action, ... }
//   prepare … 既にある予約（予約一覧の「お支払いへ進む」「カードの登録へ進む」「カードを登録し直す」）の Intent を用意する
//             { bookingId } → { payment: { mode, clientSecret, amount, consentText, ... }, returnUrl }
//   confirm … ブラウザで Stripe の確定が終わった連絡。Intent を Stripe から取り直して確かめ、予約を確定する
//             { intentId } → { result: PaymentResult }（Webhook と同じ処理・冪等）
//   release … 予約画面で支払前に仮押さえをやめる（入力に戻るとき）{ bookingId }
//   customer_session … 保存カード（2026-10-07）: 予約画面の Payment Element に取引先共有の保存カードを出す CustomerSession
//             { bookingId? }（予約一覧のモーダルは予約 id・予約画面は無し）→ { clientSecret | null, cards: [{ id, expMonth, expYear }] }
//             共有 Customer が無い・予約が予約ごとの Customer（旧予約）なら clientSecret: null（従来どおり新しいカードの入力だけ）。
//             cards は有効期限の事前警告用（チェックアウト日決済）。確認モードは POST 自体が 403
// どれもログイン中の取引先の予約だけを扱う（別の取引先の予約 id・Intent は unknown / 404）。
import { error, json } from '@sveltejs/kit';
import { confirmPartnerIntent, getPartnerBooking, inlinePaymentReady, releasePendingBooking, resumePartnerPayment } from '$lib/server/partners/booking';
import { PORTAL_HEADERS, requirePortalApi } from '$lib/server/partners/portal';
import { PartnerStoreError } from '$lib/server/partners/store';
import { isPaymentIntentId, isSetupIntentId } from '$lib/server/payments/verify';
import { StripeError } from '$lib/server/stripe';
import { createSavedCardSession, listSavedCards, resolvePartnerCustomer } from '$lib/server/payments/saved-cards';
import { savedCardCustomerFor } from '$lib/saved-cards';

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
    if (action === 'customer_session') {
      const none = () => reply({ ok: true, clientSecret: null, cards: [] });
      if (!inlinePaymentReady()) return none();
      const booking = bookingId ? (UUID.test(bookingId) ? await getPartnerBooking(db, partner.id, bookingId) : null) : null;
      if (bookingId && !booking) return none();
      const shared = await resolvePartnerCustomer(db, partner, { create: false });
      const customer = savedCardCustomerFor(shared, booking);
      if (!customer) return none();
      // Customer が Stripe 側で消えていた等の失敗は、保存カード無し（新しいカードの入力だけ）で続ける
      try {
        const cards = await listSavedCards(customer);
        if (!cards.length) return none();
        const s = await createSavedCardSession(customer);
        return reply({ ok: true, clientSecret: s.clientSecret, cards: cards.map((c) => ({ id: c.id, expMonth: c.expMonth, expYear: c.expYear })) });
      } catch (e) {
        console.warn('[partner-payment] 保存カードを出せません:', e instanceof Error ? e.message : e);
        return none();
      }
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
