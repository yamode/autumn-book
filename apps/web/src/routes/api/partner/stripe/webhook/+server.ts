// Stripe の Webhook（取引先予約のオンライン決済）。宛先: <autumn-book のオリジン>/api/partner/stripe/webhook
// （2026-09-26 に autumn-rms から移設。Stripe ダッシュボードで宛先を Book に登録し、その署名シークレットを STRIPE_WEBHOOK_SECRET に入れる）
//
// 受け取るイベント（振り分けは lib/server/payments/webhook-route.ts）:
//   - payment_intent.succeeded … 同じ画面で払う方式（v0.42.0〜）の予約時決済。ブラウザが閉じられて確定の連絡が
//                                届かなかったときの保険（rms_partner_mark_paid）
//   - setup_intent.succeeded   … 同じ画面で払う方式のチェックアウト日決済のカード登録（rms_partner_mark_card_saved）
//     ※ どちらも metadata.flow='elements' の Intent だけ。チェックイン日の自動請求（off-session）の PaymentIntent は
//       同じ app / purpose でも flow が無いので無視する（自動請求は請求処理の中で確定する）
//   - checkout.session.completed / async_payment_succeeded … 旧方式（Stripe Checkout）。切替前に開いた決済画面のため残す
//   - charge.refunded … Stripe の管理画面から返金したときの同期（全額返金なら返金済みにして PMS に返金行）
// ブラウザからの確定の連絡と同時に届いても、DB 関数が 'already' を返すので二重に確定しない（通知メールも1回）。
// 同じ Stripe アカウントには autumn-book・EC の決済も載るので、自分の決済以外は何もせず 200 を返す。
// 支払われずに放置された仮押さえは、DB の定期処理（5分ごと・rms_partner_expire_pending）が解放する。
//
// 公式サイト（一般のお客様）の予約のオンライン決済（v0.43.0〜・app=autumn-book / purpose=book_direct_booking）も
// 同じ宛先で受ける（lib/server/direct-payments.ts）:
//   - payment_intent.succeeded … direct_payment_confirm で予約確定（期限切れなら全額返金）
//   - charge.refunded          … 取引先予約の台帳に無ければ、公式サイト予約の台帳で返金を記録（PMS に refunded の電文）
//
// 客室案内の精算のオンライン決済（2026-10-17・app=autumn-book / purpose=book_inroom_bill・lib/server/inroom-bill.ts）も受ける:
//   - payment_intent.succeeded … inroom_payment_finalize で PMS の請求書に入金行（残額が足りなければ全額返金）
//   - charge.refunded          … 取引先予約の台帳に無ければ、客室案内の台帳 → 公式サイト予約の台帳の順に見る
import { json, type RequestHandler } from '@sveltejs/kit';
import { confirmCheckoutSession, confirmPartnerIntent, syncRefundFromStripe } from '$lib/server/partners/booking';
import { partnerAdminClient } from '$lib/server/partners/store';
import { routeStripeEvent } from '$lib/server/payments/webhook-route';
import { confirmDirectIntent, syncDirectRefundFromStripe } from '$lib/server/direct-payments';
import { confirmUpgradeIntent, UPGRADE_PAYMENT_PURPOSE } from '$lib/server/upgrade-payments';
import { confirmInroomIntent, STRIPE_PURPOSE_INROOM_BILL, syncInroomRefundFromStripe } from '$lib/server/inroom-bill';
import {
  STRIPE_APP,
  STRIPE_APP_BOOK,
  STRIPE_PURPOSE_DIRECT_BOOKING,
  STRIPE_PURPOSE_PARTNER_BOOKING,
  StripeError,
  verifyWebhook
} from '$lib/server/stripe';

export const POST: RequestHandler = async ({ request, url }) => {
  const payload = await request.text();
  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(payload, request.headers.get('stripe-signature'));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'invalid' }, { status: e instanceof StripeError ? e.status : 400 });
  }
  const upgradeMeta = event.data.object.metadata as Record<string, unknown> | undefined;
  if (event.type === 'payment_intent.succeeded' && upgradeMeta?.app === 'autumn-book' && upgradeMeta.purpose === UPGRADE_PAYMENT_PURPOSE) {
    try { return json({ received: true, result: await confirmUpgradeIntent(String(event.data.object.id ?? '')) }); }
    catch { return json({ error: 'upgrade confirmation requires retry' }, { status: 500 }); }
  }
  if (event.type === 'payment_intent.succeeded' && upgradeMeta?.app === STRIPE_APP_BOOK && upgradeMeta.purpose === STRIPE_PURPOSE_INROOM_BILL) {
    try { return json({ received: true, result: await confirmInroomIntent(String(event.data.object.id ?? '')) }); }
    catch (e) { return json({ error: e instanceof Error ? e.message : 'inroom confirmation requires retry' }, { status: 500 }); }
  }
  const route = routeStripeEvent(event, {
    app: STRIPE_APP,
    purposes: [STRIPE_PURPOSE_PARTNER_BOOKING],
    checkoutRefKey: 'partner_booking_id',
    also: [{ app: STRIPE_APP_BOOK, purposes: [STRIPE_PURPOSE_DIRECT_BOOKING] }]
  });
  if (route.kind === 'ignore') return json({ received: true, ignored: route.reason });

  const db = partnerAdminClient();
  if (!db) return json({ error: 'db unavailable' }, { status: 503 });
  try {
    if (route.kind === 'charge_refunded') {
      // 取引先予約かどうかは payment_intent で台帳を引いて決める（他アプリの決済なら not_ours）
      const partner = await syncRefundFromStripe(db, route.object);
      if (partner !== 'not_ours') return json({ received: true, result: partner });
      const inroom = await syncInroomRefundFromStripe(route.object);
      if (inroom !== 'not_ours') return json({ received: true, result: inroom });
      return json({ received: true, result: await syncDirectRefundFromStripe(route.object) });
    }
    if (route.kind === 'checkout_session') {
      return json({ received: true, result: await confirmCheckoutSession(db, route.id, url.origin) });
    }
    if (route.kind === 'payment_intent' && route.purpose === STRIPE_PURPOSE_DIRECT_BOOKING) {
      const r = await confirmDirectIntent(route.id);
      return json({ received: true, result: r.result });
    }
    // payment_intent / setup_intent（取引先予約 rms_partner_booking）
    return json({ received: true, result: await confirmPartnerIntent(db, route.id, url.origin) });
  } catch (e) {
    // 500 を返すと Stripe が再送してくれる
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};
