// Intent の検証（純関数）。ブラウザからの「支払が済んだ」という連絡も Webhook も、必ず Stripe から
// Intent を取り直して、ここで「自分の予約の・正しい金額の・完了した」Intent かを確かめてから確定する。
import { isElementsIntentFor } from './metadata';

export type IntentExpectation = {
  app: string;
  purpose: string;
  // metadata のどのキーに予約 id が入っているか（partner_booking_id など）と、その値（分かっていれば）
  refKey: string;
  refId?: string;
};

export type PaymentIntentLike = {
  id: string;
  status: string;
  amount: number;
  amount_received?: number | null;
  currency: string;
  metadata?: Record<string, string> | null;
};

export type SetupIntentLike = {
  id: string;
  status: string;
  customer?: string | { id: string } | null;
  payment_method?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
};

export type IntentCheck =
  | { ok: true; refId: string }
  // まだ完了していない（processing / requires_action / requires_payment_method など）
  | { ok: false; reason: 'not_succeeded'; status: string; refId: string }
  // 自分の用途の Intent ではない・別の予約のもの
  | { ok: false; reason: 'not_ours' | 'ref_mismatch' }
  // 金額・通貨が違う（作った時点の請求額と一致しない）
  | { ok: false; reason: 'amount_mismatch'; refId: string; expected: number; actual: number };

export const idOf = (v: string | { id: string } | null | undefined): string | null => (typeof v === 'string' ? v : (v?.id ?? null));

function refOf(meta: Record<string, string> | null | undefined, exp: IntentExpectation): IntentCheck | string {
  if (!isElementsIntentFor(meta, exp.app, [exp.purpose])) return { ok: false, reason: 'not_ours' };
  const ref = meta?.[exp.refKey];
  if (!ref) return { ok: false, reason: 'not_ours' };
  if (exp.refId && exp.refId !== ref) return { ok: false, reason: 'ref_mismatch' };
  return ref;
}

// 予約時決済: succeeded・通貨（既定 jpy）・金額（円）を確かめる。expectedAmount が null なら金額は見ない。
export function checkPaymentIntent(
  pi: PaymentIntentLike,
  exp: IntentExpectation & { expectedAmount: number | null; currency?: string }
): IntentCheck {
  const ref = refOf(pi.metadata, exp);
  if (typeof ref !== 'string') return ref;
  if (pi.status !== 'succeeded') return { ok: false, reason: 'not_succeeded', status: pi.status, refId: ref };
  const actual = pi.amount_received ?? pi.amount;
  const currencyOk = (pi.currency ?? '').toLowerCase() === (exp.currency ?? 'jpy');
  if (!currencyOk || (exp.expectedAmount != null && actual !== exp.expectedAmount)) {
    return { ok: false, reason: 'amount_mismatch', refId: ref, expected: exp.expectedAmount ?? actual, actual };
  }
  return { ok: true, refId: ref };
}

// チェックアウト日決済: カード登録（SetupIntent）が succeeded で、顧客とカードが付いているか。
export function checkSetupIntent(si: SetupIntentLike, exp: IntentExpectation): IntentCheck {
  const ref = refOf(si.metadata, exp);
  if (typeof ref !== 'string') return ref;
  if (si.status !== 'succeeded' || !idOf(si.customer) || !idOf(si.payment_method)) {
    return { ok: false, reason: 'not_succeeded', status: si.status, refId: ref };
  }
  return { ok: true, refId: ref };
}

// JPY はゼロ小数通貨なので円のまま。Stripe の最低額（50円）未満・数でない額は作らない。
export const STRIPE_MIN_JPY = 50;
export function toStripeJpy(yen: number): number {
  const n = Math.round(yen);
  if (!Number.isFinite(n) || n < STRIPE_MIN_JPY) throw new Error(`決済できる金額ではありません（${yen}円）`);
  return n;
}

// Intent id の形式（ブラウザから届いた値の入口チェック）
export const isPaymentIntentId = (v: string) => /^pi_[A-Za-z0-9]+$/.test(v);
export const isSetupIntentId = (v: string) => /^seti_[A-Za-z0-9]+$/.test(v);

const REUSABLE = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);

// この Intent をもう一度ブラウザに渡してよいか（純関数）。
export function isReusableIntent(
  intent: { status: string; metadata?: Record<string, string> | null; amount?: number | null },
  expect: { app: string; purpose: string; refKey: string; refId: string; amount?: number | null }
): boolean {
  if (!REUSABLE.has(intent.status)) return false;
  if (!isElementsIntentFor(intent.metadata, expect.app, [expect.purpose])) return false;
  if (intent.metadata?.[expect.refKey] !== expect.refId) return false;
  if (expect.amount != null && intent.amount !== expect.amount) return false;
  return true;
}
