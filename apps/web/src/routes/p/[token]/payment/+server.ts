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
//
// 保存カードと本人確認（docs/auth-hardening.md §5.2・S4）:
//   - customer_session は本人確認済み（aal2）のセッションにだけ発行する。未確認なら clientSecret: null と mfaRequired（保存カードがあるとき）を返す
//   - prepare は aal2 でなければ Customer 無しの Intent を用意する（保存カードは Stripe が断る＝サーバ側の強制。booking.ts preparePartnerPayment）。
//     カードの登録し直しは aal2 が必須（403 mfa_required）
//   - 予約画面の確定（/book/reserve）も同じ条件で Intent を作る
//   - オフセッション請求（チェックアウト日決済・キャンセル料）は aal を見ない（台帳の Customer＋PaymentMethod の組だけ）
import { error, json } from '@sveltejs/kit';
import { confirmPartnerIntent, getPartnerBooking, inlinePaymentReady, releasePendingBooking, resumePartnerPayment } from '$lib/server/partners/booking';
import { portalAal2, PORTAL_HEADERS, requirePortalApi } from '$lib/server/partners/portal';
import { aal2ApiProblem } from '$lib/server/partners/mfa';
import { stepUpState } from '$lib/server/partners/passkeys';
import { portalMfaUrl } from '$lib/partner-mfa';
import { PartnerStoreError } from '$lib/server/partners/store';
import { isPaymentIntentId, isSetupIntentId } from '$lib/server/payments/verify';
import { StripeError } from '$lib/server/stripe';
import { createSavedCardSession, listSavedCards, resolvePartnerCustomer } from '$lib/server/payments/saved-cards';
import { savedCardCustomerFor } from '$lib/saved-cards';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = async (event) => {
  const { db, partner, session } = await requirePortalApi(event);
  const aal2 = portalAal2(session);
  // 本人確認の後に戻る先: 予約一覧（モーダル）から来た予約は予約一覧、予約画面はブラウザが渡した戻り先（無ければ予約一覧）
  const backTo = `/p/${event.params.token}/bookings`;
  const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');
  const bookingId = String(body.bookingId ?? '');
  const intentId = String(body.intentId ?? '');
  const reply = (data: unknown, status = 200) => json(data, { status, headers: PORTAL_HEADERS });
  try {
    if (action === 'prepare') {
      if (!UUID.test(bookingId)) throw error(400, '予約の指定が正しくありません。');
      const payment = await resumePartnerPayment(db, partner, bookingId, { aal2 });
      return reply({ ok: true, payment, returnUrl: `${event.url.origin}/p/${event.params.token}/bookings` });
    }
    if (action === 'confirm') {
      if (!isPaymentIntentId(intentId) && !isSetupIntentId(intentId)) throw error(400, '決済の指定が正しくありません。');
      const result = await confirmPartnerIntent(db, intentId, event.url.origin, partner.id);
      return reply({ ok: true, result });
    }
    if (action === 'customer_session') {
      const none = () => reply({ ok: true, clientSecret: null, cards: [] });
      // 本人確認がまだ: 保存カードは出さない。保存カードがあれば、本人確認すれば選べることを画面に知らせる（件数だけ）
      // 予約画面がその場で本人確認できるよう、送り先（伏せたもの）と方法・再送の待ちも返す
      const needMfa = async (count: number) => {
        const state = await stepUpState(db, event, partner, session).catch(() => null);
        return reply({
          ok: true,
          clientSecret: null,
          cards: [],
          mfaRequired: count > 0,
          savedCount: count,
          mfaUrl: portalMfaUrl(event.params.token, String(body.next || backTo)),
          // 方法はパスキー（このホストで使えるとき・S6）とメール
          stepUp: {
            maskedEmail: state?.maskedEmail ?? '',
            methods: state?.methods ?? [],
            waitSec: state?.waitSec ?? 0,
            open: state?.open ?? false
          }
        });
      };
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
        if (!aal2) return needMfa(cards.length);
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
    if (e instanceof PartnerStoreError && e.code === 'mfa_required') return aal2ApiProblem(event, session, backTo) ?? reply({ ok: false, message: e.message }, 403);
    if (e instanceof PartnerStoreError) return reply({ ok: false, message: e.message }, e.status >= 400 && e.status < 600 ? e.status : 400);
    if (e instanceof StripeError) return reply({ ok: false, message: 'お支払いの準備ができませんでした。時間をおいてお試しください。' }, 502);
    throw e;
  }
};
