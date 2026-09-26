// Stripe の Webhook（取引先予約のオンライン決済）。宛先: <autumn-book のオリジン>/api/partner/stripe/webhook
// （2026-09-26 に autumn-rms から移設。Stripe ダッシュボードで宛先を Book に登録し、その署名シークレットを STRIPE_WEBHOOK_SECRET に入れる）
// 受け取るイベント: checkout.session.completed（予約時決済の支払完了・チェックイン日決済のカード登録完了）/ async_payment_succeeded / charge.refunded
// 署名（STRIPE_WEBHOOK_SECRET）を確かめてから、支払完了を記録して予約を確定・PMS へ送る。
// charge.refunded は Stripe の管理画面から返金したときの同期（全額返金なら返金済みにして PMS に返金行）。
// 同じ Stripe アカウントには autumn-book・EC の決済も載るので、取引先予約の決済（metadata.partner_booking_id が
// あり、app が autumn-rms か未設定）以外は何もせず 200 を返す。
// 支払われずに失効した決済画面（checkout.session.expired）は、DB の定期処理（5分ごと）が仮押さえを解放する。
import { json, type RequestHandler } from '@sveltejs/kit';
import { confirmOnlinePayment, syncRefundFromStripe } from '$lib/server/partners/booking';
import { partnerAdminClient } from '$lib/server/partners/store';
import { STRIPE_APP, StripeError, verifyWebhook } from '$lib/server/stripe';

export const POST: RequestHandler = async ({ request, url }) => {
  const payload = await request.text();
  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(payload, request.headers.get('stripe-signature'));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'invalid' }, { status: e instanceof StripeError ? e.status : 400 });
  }
  const obj = event.data.object;
  const db = partnerAdminClient();
  if (event.type === 'charge.refunded') {
    if (!db) return json({ error: 'db unavailable' }, { status: 503 });
    try {
      // 取引先予約かどうかは payment_intent で台帳を引いて決める（他アプリの決済なら not_ours）
      return json({ received: true, result: await syncRefundFromStripe(db, obj) });
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return json({ received: true, ignored: event.type });
  }
  const meta = (obj.metadata ?? {}) as Record<string, string>;
  if (!meta.partner_booking_id || (meta.app && meta.app !== STRIPE_APP)) {
    return json({ received: true, ignored: 'not_rms_partner_booking' });
  }
  if (!db) return json({ error: 'db unavailable' }, { status: 503 });
  const sessionId = String(event.data.object.id ?? '');
  if (!sessionId) return json({ received: true });
  try {
    const result = await confirmOnlinePayment(db, sessionId, url.origin);
    return json({ received: true, result });
  } catch (e) {
    // 500 を返すと Stripe が再送してくれる
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
};
