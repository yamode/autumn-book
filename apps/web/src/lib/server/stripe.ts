// Stripe（取引先予約のオンライン決済）。SDK は使わず REST API を fetch で呼ぶ（Cloudflare Workers で軽く動かすため）。
//
// 【必要な環境変数（Cloudflare Pages のシークレット）】
//   - STRIPE_SECRET_KEY              … sk_test_… / sk_live_…（テストモードから始める）
//   - STRIPE_WEBHOOK_SECRET          … whsec_…（Stripe の Webhook 宛先 /api/partner/stripe/webhook の署名シークレット）
//   - PUBLIC_STRIPE_PUBLISHABLE_KEY  … pk_test_… / pk_live_…（ブラウザの Stripe.js に渡す公開可能キー。v0.42.0〜）
// 決済は同じ画面で払う方式（Payment Element・deferred intent。lib/components/payment/StripePayment.svelte）。
// シークレットキーと公開可能キーがそろわなければ、オンライン決済は取引先の画面に出さない（inlinePaymentReady）。
// チェックイン日の自動請求（cron）はシークレットキーだけで動く（onlinePaymentReady）。
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { cleanKey, keyMode, publishableKeyIssue, type PublishableKeyIssue } from './payments/keys';

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

// 公式サイト（一般のお客様）の予約のオンライン決済（v0.43.0〜）。こちらは最初から Book が作る決済なので app は autumn-book。
// Webhook は取引先予約（app=autumn-rms）と同じ宛先で受け、metadata の app / purpose で振り分ける（payments/webhook-route.ts）。
export const STRIPE_APP_BOOK = 'autumn-book';
export const STRIPE_PURPOSE_DIRECT_BOOKING = 'book_direct_booking';

// 保存カード（マイページのカード登録・2026-10-07・docs/saved-cards.md）。取引先は取引先ごと（app は取引先予約と同じ autumn-rms）、
// 会員は会員ごとの Customer に付ける。Webhook の purposes には含めない（setup_intent.succeeded は ignore で 200）。
// 登録の確定はブラウザからの連絡だけで行う（予約が無いので Webhook での確定は要らない）。
export const STRIPE_PURPOSE_PARTNER_CARD = 'rms_partner_card';
export const STRIPE_PURPOSE_MEMBER_CARD = 'book_member_card';

// 貼り付け時の空白・引用符・見えない文字は cleanKey（payments/keys.ts）で取り除く。
const secretKey = () => cleanKey(privateEnv.STRIPE_SECRET_KEY);
const webhookSecret = () => cleanKey(privateEnv.STRIPE_WEBHOOK_SECRET);
const publishableKeyRaw = () => cleanKey(publicEnv.PUBLIC_STRIPE_PUBLISHABLE_KEY);

// 登録されているキーの種類（値は出さず、先頭の形式だけで判定する）。
// sk_ = シークレットキー / rk_ = 制限付きキー（PaymentIntent・SetupIntent・Customer・返金の権限があれば使える）/ pk_ = 公開可能キー（サーバでは使えない）。
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
// サーバから Stripe を呼べるか（シークレットキーだけ。自動請求・返金・旧決済画面の確認に使う）
export const onlinePaymentReady = () => ['secret', 'restricted'].includes(stripeKeyKind());
export const stripeTestMode = () => keyMode(secretKey()) === 'test';

// 公開可能キーの問題（無ければ null）。シークレットキーが無いときは見ない（onlinePaymentReady が先に落ちる）。
export const publishableKeyProblem = (): PublishableKeyIssue | null => publishableKeyIssue(secretKey(), publishableKeyRaw());

// 同じ画面で払う方式を画面に出せるか（シークレットキー＋公開可能キー・テスト/本番がそろっている）
export const inlinePaymentReady = () => onlinePaymentReady() && publishableKeyProblem() === null;

// ブラウザへ渡す公開可能キー。使える状態のときだけ返す（pk_ 以外は絶対に返さない）。
export const stripePublishableKey = (): string | null => (inlinePaymentReady() ? publishableKeyRaw() : null);

export class StripeError extends Error {
  constructor(
    message: string,
    public status = 502,
    // card_declined / authentication_required / insufficient_funds など（請求失敗の理由表示用）
    public code: string | null = null,
    // エラーの種類（card_error / invalid_request_error / idempotency_error など）
    public type: string | null = null
  ) {
    super(message);
  }
}

// 指定した Customer・PaymentMethod 等が Stripe に無い（No such customer 等。ダッシュボードで消された・テスト/本番の取り違え）
export const isStripeResourceMissing = (e: unknown): boolean => e instanceof StripeError && e.code === 'resource_missing';

// 冪等キーの衝突（同じキーで別のパラメータ＝名前・メールが変わった再送など。type=idempotency_error）
export const isStripeIdempotencyError = (e: unknown): boolean => e instanceof StripeError && e.type === 'idempotency_error';

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
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string; decline_code?: string; type?: string } } & T;
  if (!res.ok) {
    const code = json.error?.decline_code ?? json.error?.code;
    throw new StripeError(`Stripe: ${json.error?.message ?? res.status}${code ? `（${code}）` : ''}`, res.status, code ?? null, json.error?.type ?? null);
  }
  return json;
}

// 旧方式（Stripe Checkout の別ページ）の決済画面。2026-09-26（v0.42.0）に同じ画面で払う方式（Payment Element）へ
// 切り替えたので新しくは作らないが、切替前に開いた決済画面の完了（Webhook checkout.session.completed）を
// 処理するため、読み取りだけ残す。
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

export const retrieveCheckoutSession = (id: string, expandSetup = false) =>
  stripeFetch<CheckoutSession>(
    'GET',
    `/checkout/sessions/${encodeURIComponent(id)}`,
    expandSetup ? { expand: ['setup_intent', 'setup_intent.payment_method'] } : undefined
  );

// ---- カードを登録して後日請求（チェックアウト日決済）----

export type StripePaymentMethod = {
  id: string;
  card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number; fingerprint?: string | null } | null;
  // 以下は保存カード（一覧・取り外しの検証）で使う。expand した SetupIntent の payment_method にも入っている
  customer?: string | { id: string } | null;
  created?: number;
  allow_redisplay?: 'always' | 'limited' | 'unspecified';
  metadata?: Record<string, string>;
};

// 画面表示用のカード名（例: Visa •••• 4242）
export function cardLabelOf(pm: StripePaymentMethod | null | undefined): string | null {
  if (!pm?.card) return null;
  const brand = (pm.card.brand ?? '').replace(/^./, (c) => c.toUpperCase()).replace('Amex', 'American Express');
  return `${brand} •••• ${pm.card.last4 ?? ''}`.trim();
}

export const createCustomer = (args: { name: string; email?: string | null; metadata: Record<string, string>; idempotencyKey: string }) =>
  stripeFetch<{ id: string; livemode?: boolean }>(
    'POST',
    '/customers',
    { name: args.name.slice(0, 250), email: args.email || undefined, metadata: args.metadata },
    args.idempotencyKey
  );

// ---- 保存カード（Customer に付けたカード・2026-10-07）----

export type StripeCustomer = {
  id: string;
  deleted?: boolean;
  livemode?: boolean;
  invoice_settings?: { default_payment_method?: string | { id: string } | null } | null;
};

export const retrieveCustomer = (id: string) => stripeFetch<StripeCustomer>('GET', `/customers/${encodeURIComponent(id)}`);

// 既定のカード（Payment Element の「保存済み」で先頭に出る）を設定する
export const updateCustomer = (id: string, args: { defaultPaymentMethod?: string }) =>
  stripeFetch<StripeCustomer>('POST', `/customers/${encodeURIComponent(id)}`, {
    invoice_settings: args.defaultPaymentMethod ? { default_payment_method: args.defaultPaymentMethod } : undefined
  });

// ブラウザの Payment Element に「この Customer の保存カードを見せてよい」と伝える短命の資格情報（30 分で失効）。
// save: 「このカードを保存する」チェックボックスを出すか（第1段階は出さない・N3）。Element からの削除はさせない（削除はマイページだけ）。
export const createCustomerSession = (args: { customer: string; save?: boolean; redisplayLimit?: number }) =>
  stripeFetch<{ client_secret: string; expires_at: number }>('POST', '/customer_sessions', {
    customer: args.customer,
    components: {
      payment_element: {
        enabled: true,
        features: {
          payment_method_redisplay: 'enabled',
          payment_method_redisplay_limit: args.redisplayLimit ?? 10,
          // マイページで保存の同意を取って allow_redisplay=always にしたカードだけ出す
          // （予約ごとのカード登録で付いたカード＝unspecified は出さない）
          payment_method_allow_redisplay_filters: ['always'],
          payment_method_save: args.save ? 'enabled' : 'disabled',
          payment_method_remove: 'disabled'
        }
      }
    }
  });

// Customer に付いているカード（新しい順・最大 100 枚）
export const listPaymentMethods = (customer: string) =>
  stripeFetch<{ data: StripePaymentMethod[] }>('GET', `/customers/${encodeURIComponent(customer)}/payment_methods`, { type: 'card', limit: 100 });

export const retrievePaymentMethod = (id: string) => stripeFetch<StripePaymentMethod>('GET', `/payment_methods/${encodeURIComponent(id)}`);

export const updatePaymentMethod = (id: string, args: { allowRedisplay?: 'always' | 'limited' | 'unspecified'; metadata?: Record<string, string> }) =>
  stripeFetch<StripePaymentMethod>('POST', `/payment_methods/${encodeURIComponent(id)}`, { allow_redisplay: args.allowRedisplay, metadata: args.metadata });

// Customer から外す（以後どの Intent でも使えない。未請求の予約が使っていないことを呼び出し側で確かめる）
export const detachPaymentMethod = (id: string) => stripeFetch<StripePaymentMethod>('POST', `/payment_methods/${encodeURIComponent(id)}/detach`);

export type PaymentIntent = {
  id: string;
  status: string;
  amount: number;
  amount_received?: number | null;
  currency: string;
  client_secret?: string | null;
  latest_charge?: string | null;
  customer?: string | { id: string } | null;
  metadata: Record<string, string>;
};

export type SetupIntent = {
  id: string;
  status: string;
  client_secret?: string | null;
  customer: string | { id: string } | null;
  // expand すると中身（カードの種類・下4桁）が入る
  payment_method: string | StripePaymentMethod | null;
  metadata: Record<string, string>;
};

// ---- 同じ画面で払う方式（Payment Element・deferred intent）----
// ブラウザは Elements を mode/amount/currency で先に表示し、確定ボタンでサーバにこの Intent を作らせて
// client_secret で confirmPayment / confirmSetup する。支払方法はカードに固定する（Apple Pay・Google Pay は
// カード扱いで出る）。管理画面の「決済手段」はアカウント共通なので、EC 等のためにコンビニ決済・銀行振込を
// 有効にしても、ここには出さない（後から支払われる決済手段では 35分の仮押さえが先に切れるため）。
// ⚠ ブラウザ側の Elements も paymentMethodTypes: ['card'] にそろえる（食い違うと confirm が失敗する）。

// 予約時決済（その場でカードに請求）。
// customer: 保存カードを選べるようにするとき（ブラウザの CustomerSession と同じ Customer・2026-10-07）。
// 付けても setup_future_usage は付けないので、新しく入力したカードは保存されない。
export const createPaymentIntent = (args: {
  amount: number; // 円（JPY はゼロ小数通貨）
  description: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
  customer?: string | null;
}) =>
  stripeFetch<PaymentIntent>(
    'POST',
    '/payment_intents',
    {
      amount: Math.round(args.amount),
      currency: 'jpy',
      customer: args.customer || undefined,
      payment_method_types: ['card'],
      description: args.description.slice(0, 1000),
      metadata: args.metadata
    },
    args.idempotencyKey
  );

export const retrievePaymentIntent = (id: string) => stripeFetch<PaymentIntent>('GET', `/payment_intents/${encodeURIComponent(id)}`);

// チェックアウト日決済（カードを登録して後日 off-session で請求）。本人認証（3Dセキュア）は登録時に済ませる。
// マイページの保存カードの登録にも使う（冪等キー無し＝毎回新しく作る・N8）。
export const createSetupIntent = (args: { customer: string; description: string; metadata: Record<string, string>; idempotencyKey?: string }) =>
  stripeFetch<SetupIntent>(
    'POST',
    '/setup_intents',
    {
      customer: args.customer,
      usage: 'off_session',
      payment_method_types: ['card'],
      description: args.description.slice(0, 1000),
      metadata: args.metadata
    },
    args.idempotencyKey
  );

// SetupIntent の metadata だけを更新する（succeeded の後も更新できる。送ったキーだけ上書き・値 '' はそのキーを消す）。
// チェックアウト日決済の請求予定日・金額・予約の状態を Stripe の管理画面から読めるようにするため（2026-10-10）。
export const updateSetupIntentMetadata = (id: string, metadata: Record<string, string>) =>
  stripeFetch<SetupIntent>('POST', `/setup_intents/${encodeURIComponent(id)}`, { metadata });

export const retrieveSetupIntent = (id: string, expandPaymentMethod = false) =>
  stripeFetch<SetupIntent>('GET', `/setup_intents/${encodeURIComponent(id)}`, expandPaymentMethod ? { expand: ['payment_method'] } : undefined);

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

// amount を省くと全額（残り全部）を返金する。一部返金（キャンセル料を差し引いた返金）は amount（円）を渡す
export const createRefund = (paymentIntent: string, idempotencyKey: string, metadata: Record<string, string> = {}, amount?: number) =>
  stripeFetch<{ id: string; status: string; amount: number }>(
    'POST',
    '/refunds',
    { payment_intent: paymentIntent, metadata, amount: amount != null ? Math.round(amount) : undefined },
    idempotencyKey
  );

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
