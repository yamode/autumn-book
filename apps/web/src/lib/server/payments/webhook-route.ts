// Stripe の Webhook イベントの振り分け（純関数）。
//
// どのイベントを「自分の処理」として扱うかだけを決め、実際の確定（DB の更新・メール）は呼び出し側が行う。
// 同じ Stripe アカウントの他アプリ（EC 等）の決済は ignore にして 200 を返させる（500 を返すと Stripe が再送し続ける）。
import { isElementsIntentFor } from './metadata';

export type StripeEventLike = { type: string; data: { object: Record<string, unknown> } };

export type WebhookRoute =
  // 同じ画面で払う方式: 支払完了（予約時決済）
  | { kind: 'payment_intent'; id: string; purpose: string }
  // 同じ画面で払う方式: カード登録完了（チェックイン日決済）
  | { kind: 'setup_intent'; id: string; purpose: string }
  // 旧方式（Stripe Checkout）の決済画面の完了。切替前に開いた画面のため残す
  | { kind: 'checkout_session'; id: string }
  // 返金（Stripe の管理画面からの返金の同期）。自分の決済かは呼び出し側が台帳で確かめる
  | { kind: 'charge_refunded'; object: Record<string, unknown> }
  | { kind: 'ignore'; reason: string };

export type WebhookRouteOptions = {
  app: string;
  purposes: readonly string[];
  // 旧 Checkout の決済のうち自分のものを見分けるキー（metadata に必ずあるもの）
  checkoutRefKey: string;
  // 同じ宛先で受ける別のアプリ・用途（公式サイト予約 app=autumn-book / purpose=book_direct_booking など）。
  // 同じ画面で払う方式の Intent（payment_intent / setup_intent）だけが対象（旧 Checkout は取引先予約だけ）。
  also?: readonly { app: string; purposes: readonly string[] }[];
};

export function routeStripeEvent(event: StripeEventLike, opts: WebhookRouteOptions): WebhookRoute {
  const obj = event.data?.object ?? {};
  const id = typeof obj.id === 'string' ? obj.id : '';
  const meta = (obj.metadata && typeof obj.metadata === 'object' ? obj.metadata : {}) as Record<string, unknown>;
  switch (event.type) {
    case 'charge.refunded':
      return { kind: 'charge_refunded', object: obj };
    case 'payment_intent.succeeded':
    case 'setup_intent.succeeded': {
      if (!id) return { kind: 'ignore', reason: 'no_id' };
      const ours = [{ app: opts.app, purposes: opts.purposes }, ...(opts.also ?? [])].some((t) => isElementsIntentFor(meta, t.app, t.purposes));
      if (!ours) return { kind: 'ignore', reason: 'not_ours' };
      const kind = event.type === 'payment_intent.succeeded' ? 'payment_intent' : 'setup_intent';
      return { kind, id, purpose: String(meta.purpose) };
    }
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (!id) return { kind: 'ignore', reason: 'no_id' };
      // 旧方式の取引先予約: 予約 id があり、app が自分か未設定（app を付ける前に作った決済）
      if (!meta[opts.checkoutRefKey] || (meta.app && meta.app !== opts.app)) return { kind: 'ignore', reason: 'not_ours' };
      return { kind: 'checkout_session', id };
    }
    default:
      return { kind: 'ignore', reason: event.type };
  }
}
