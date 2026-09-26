// Stripe（取引先予約のオンライン決済）。SDK は使わず REST API を fetch で呼ぶ（Cloudflare Workers で軽く動かすため）。
//
// 【必要な環境変数（Cloudflare Pages のシークレット）】
//   - STRIPE_SECRET_KEY      … sk_test_… / sk_live_…（テストモードから始める）
//   - STRIPE_WEBHOOK_SECRET  … whsec_…（Stripe の Webhook 宛先 /api/partner/stripe/webhook の署名シークレット）
// STRIPE_SECRET_KEY が無ければオンライン決済は取引先の画面に出さない（onlinePaymentReady）。
import { env as privateEnv } from '$env/dynamic/private';

const API = 'https://api.stripe.com/v1';

// 同じ Stripe アカウントに autumn-book（公式サイト予約）・EC など複数の決済が載る前提で、
// 決済には必ず「どのアプリの・何の決済か」を metadata に付ける。Webhook はアカウントの全イベントを
// 受け取るので、自分の用途（purpose）以外は何もせず 200 を返す（500 を返すと Stripe が再送し続ける）。
//   app     … 決済を作ったアプリ（autumn-rms / autumn-book / …）
//   purpose … 用途（rms_partner_booking = 取引先予約）
// ⚠ 取引先ページは 2026-09-26 に autumn-rms から autumn-book へ移設したが、app / purpose の値は変えない。
//   移設前に作った予約（PB-2026-000003 等）の決済・返金 Webhook も同じ値で見分けて処理するため。
export const STRIPE_APP = 'autumn-rms';
export const STRIPE_PURPOSE_PARTNER_BOOKING = 'rms_partner_booking';

// 貼り付け時に混ざりやすい前後の空白・引用符・見えない文字（BOM・ゼロ幅スペース）を取り除く。
const cleanSecret = (v: string | undefined) =>
  (v ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
const secretKey = () => cleanSecret(privateEnv.STRIPE_SECRET_KEY);
const webhookSecret = () => cleanSecret(privateEnv.STRIPE_WEBHOOK_SECRET);

// 登録されているキーの種類（値は出さず、先頭の形式だけで判定する）。
// sk_ = シークレットキー / rk_ = 制限付きキー（Checkout・返金の権限があれば使える）/ pk_ = 公開可能キー（サーバでは使えない）。
export type StripeKeyKind = 'missing' | 'secret' | 'restricted' | 'publishable' | 'webhook_secret' | 'invalid';
export function stripeKeyKind(): StripeKeyKind {
  const k = secretKey();
  if (!k) return 'missing';
  if (k.startsWith('sk_')) return 'secret';
  if (k.startsWith('rk_')) return 'restricted';
  if (k.startsWith('pk_')) return 'publishable';
  if (k.startsWith('whsec_')) return 'webhook_secret';
  return 'invalid';
}
// 形式が判別できないときの手がかり（先頭3文字と文字数だけ。秘密の部分は出さない）。
export function stripeKeyHint(): string {
  const k = secretKey();
  return k ? `先頭「${k.slice(0, 3)}」・${k.length}文字` : '未登録';
}
export const onlinePaymentReady = () => ['secret', 'restricted'].includes(stripeKeyKind());
export const stripeTestMode = () => /^(sk|rk)_test_/.test(secretKey());

export class StripeError extends Error {
  constructor(
    message: string,
    public status = 502,
    // card_declined / authentication_required / insufficient_funds など（請求失敗の理由表示用）
    public code: string | null = null
  ) {
    super(message);
  }
}

// Stripe の form-encoded（ネストは a[b][c]=v）に直す。
function encodeForm(params: Record<string, unknown>, prefix = '', out: URLSearchParams = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? encodeForm(item as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === 'object') encodeForm(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripeFetch<T>(method: 'GET' | 'POST', path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const key = secretKey();
  if (!key) throw new StripeError('Stripe が設定されていません（STRIPE_SECRET_KEY）。', 503);
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  let url = `${API}${path}`;
  let body: string | undefined;
  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = encodeForm(params ?? {}).toString();
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  } else if (params) {
    url += `?${encodeForm(params).toString()}`;
  }
  const res = await fetch(url, { method, headers, body });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string; decline_code?: string } } & T;
  if (!res.ok) {
    const code = json.error?.decline_code ?? json.error?.code;
    throw new StripeError(`Stripe: ${json.error?.message ?? res.status}${code ? `（${code}）` : ''}`, res.status, code ?? null);
  }
  return json;
}

export type CheckoutSession = {
  id: string;
  mode?: 'payment' | 'setup';
  customer?: string | null;
  // mode=setup のとき。expand すると中身（payment_method まで）が入る
  setup_intent?: string | { id: string; status: string; payment_method: string | StripePaymentMethod | null } | null;
  url: string | null;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  payment_intent: string | null;
  amount_total: number | null;
  metadata: Record<string, string>;
  expires_at: number;
};

export function createCheckoutSession(args: {
  amount: number; // 円（JPY はゼロ小数通貨なのでそのまま）
  productName: string;
  description: string;
  // 入湯税（別の明細行で出す。0 なら出さない）
  bathTax?: number;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string | null;
  metadata: Record<string, string>;
  expiresInMinutes?: number; // Stripe は 30分〜24時間
  idempotencyKey: string;
}): Promise<CheckoutSession> {
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(30, Math.min(1440, args.expiresInMinutes ?? 30)) * 60 + 5;
  return stripeFetch<CheckoutSession>(
    'POST',
    '/checkout/sessions',
    {
      mode: 'payment',
      locale: 'ja',
      // カードに固定する（Apple Pay・Google Pay はカード扱いで出る）。管理画面の「決済手段」は
      // アカウント共通なので、EC 等のためにコンビニ決済・銀行振込を有効にしても、ここには出さない。
      // 後から支払われる決済手段では 30分の仮押さえが先に切れ、支払後に自動返金になってしまうため。
      payment_method_types: ['card'],
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      expires_at: expiresAt,
      client_reference_id: args.metadata.partner_booking_id,
      customer_email: args.customerEmail || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'jpy',
            unit_amount: Math.round(args.amount),
            product_data: { name: args.productName.slice(0, 250), description: args.description.slice(0, 500) }
          }
        },
        ...((args.bathTax ?? 0) > 0
          ? [{ quantity: 1, price_data: { currency: 'jpy', unit_amount: Math.round(args.bathTax ?? 0), product_data: { name: '入湯税' } } }]
          : [])
      ],
      metadata: args.metadata,
      payment_intent_data: { metadata: args.metadata, description: args.productName.slice(0, 250) }
    },
    args.idempotencyKey
  );
}

export const retrieveCheckoutSession = (id: string, expandSetup = false) =>
  stripeFetch<CheckoutSession>(
    'GET',
    `/checkout/sessions/${encodeURIComponent(id)}`,
    expandSetup ? { expand: ['setup_intent', 'setup_intent.payment_method'] } : undefined
  );

// ---- カードを登録して後日請求（チェックイン日決済）----

export type StripePaymentMethod = { id: string; card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number } | null };

// 画面表示用のカード名（例: Visa •••• 4242）
export function cardLabelOf(pm: StripePaymentMethod | null | undefined): string | null {
  if (!pm?.card) return null;
  const brand = (pm.card.brand ?? '').replace(/^./, (c) => c.toUpperCase()).replace('Amex', 'American Express');
  return `${brand} •••• ${pm.card.last4 ?? ''}`.trim();
}

export const createCustomer = (args: { name: string; email?: string | null; metadata: Record<string, string>; idempotencyKey: string }) =>
  stripeFetch<{ id: string }>(
    'POST',
    '/customers',
    { name: args.name.slice(0, 250), email: args.email || undefined, metadata: args.metadata },
    args.idempotencyKey
  );

// カード登録の画面（Checkout mode=setup）。本人認証（3Dセキュア）もここで済ませ、後日の請求（off-session）に使える状態で保存する。
export function createSetupSession(args: {
  customer: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  // 後日の請求（off-session）への同意文。登録ボタンの下に出し、SetupIntent の metadata にも残す。
  consentText: string;
  expiresInMinutes?: number;
  idempotencyKey: string;
}): Promise<CheckoutSession> {
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(30, Math.min(1440, args.expiresInMinutes ?? 30)) * 60 + 5;
  return stripeFetch<CheckoutSession>(
    'POST',
    '/checkout/sessions',
    {
      mode: 'setup',
      custom_text: { submit: { message: args.consentText.slice(0, 1200) } },
      locale: 'ja',
      currency: 'jpy',
      customer: args.customer,
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      expires_at: expiresAt,
      client_reference_id: args.metadata.partner_booking_id,
      // カードに固定（コンビニ決済等は後日請求できない）
      payment_method_types: ['card'],
      metadata: args.metadata,
      setup_intent_data: { metadata: { ...args.metadata, consent_text: args.consentText.slice(0, 500) }, description: args.description.slice(0, 500) }
    },
    args.idempotencyKey
  );
}

export type PaymentIntent = { id: string; status: string; amount: number; latest_charge?: string | null };

// 登録済みカードへの請求（お客様がその場にいない off-session）。失敗は StripeError（code に理由）。
export const chargeSavedCard = (args: {
  customer: string;
  paymentMethod: string;
  amount: number;
  description: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}) =>
  stripeFetch<PaymentIntent>(
    'POST',
    '/payment_intents',
    {
      amount: Math.round(args.amount),
      currency: 'jpy',
      customer: args.customer,
      payment_method: args.paymentMethod,
      off_session: true,
      confirm: true,
      description: args.description.slice(0, 250),
      metadata: args.metadata
    },
    args.idempotencyKey
  );

export const listRefunds = (paymentIntent: string) =>
  stripeFetch<{ data: Array<{ id: string; amount: number; status: string }> }>('GET', '/refunds', { payment_intent: paymentIntent, limit: 10 });

export const createRefund = (paymentIntent: string, idempotencyKey: string, metadata: Record<string, string> = {}) =>
  stripeFetch<{ id: string; status: string }>('POST', '/refunds', { payment_intent: paymentIntent, metadata }, idempotencyKey);

// ---- Webhook の署名検証（Stripe-Signature: t=…,v1=…）----

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhook(payload: string, header: string | null, toleranceSec = 300): Promise<{ type: string; data: { object: Record<string, unknown> } }> {
  const secret = webhookSecret();
  if (!secret) throw new StripeError('Webhook の署名シークレット（STRIPE_WEBHOOK_SECRET）が設定されていません。', 503);
  if (!header) throw new StripeError('署名がありません。', 400);
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]).filter((p) => p.length === 2)) as Record<string, string>;
  const signatures = header
    .split(',')
    .filter((kv) => kv.startsWith('v1='))
    .map((kv) => kv.slice(3));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !signatures.length) throw new StripeError('署名の形式が正しくありません。', 400);
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) throw new StripeError('署名の時刻が古すぎます。', 400);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)));
  if (!signatures.some((s) => timingSafeEqual(s, expected))) throw new StripeError('署名が一致しません。', 400);
  return JSON.parse(payload);
}
