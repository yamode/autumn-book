// 公式サイト（一般のお客様）の予約のオンライン決済（Stripe・同じ画面で払う方式・v0.43.0）。
//
// 取引先予約（lib/server/partners/booking.ts）と同じ考え方:
//   確定ボタン → ①仮押さえ（既存の book.holds）にお客様情報を結び付けて請求額を DB で決める（direct_payment_prepare）
//   → ②PaymentIntent（metadata: app=autumn-book / purpose=book_direct_booking / flow=elements / hold_id）
//   → ③ブラウザで confirmPayment（redirect: 'if_required'）
//   → ④サーバで Intent を Stripe から取り直して検証 → direct_payment_confirm（中で book.confirm_booking）
//   Webhook（payment_intent.succeeded）も④と同じ処理（ブラウザが閉じられた保険）。DB の行ロックで二重確定しない。
//   仮押さえの期限切れ等で予約にできなかったら全額返金する。
// 取消（お客様・会員・管理画面）の後は refundAfterCancel で「支払額 − キャンセル料」を返金する。
//
// DB は service_role の RPC（book.direct_payment_*・autumn-shared 20260926113646）だけで触る。
// その migration が未適用・鍵が無い環境では directPaymentsReady() が false になり、画面は現地払いだけにする。
import type { SupabaseClient } from '@supabase/supabase-js';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import {
  createRefund,
  inlinePaymentReady,
  listRefunds,
  retrievePaymentIntent,
  STRIPE_APP_BOOK,
  STRIPE_PURPOSE_DIRECT_BOOKING,
  stripePublishableKey,
  StripeError
} from '$lib/server/stripe';
import { buildIntentMetadata } from '$lib/server/payments/metadata';
import { preparePaymentIntent } from '$lib/server/payments/intents';
import { checkPaymentIntent, isPaymentIntentId } from '$lib/server/payments/verify';
import type { GuestInfo } from '$lib/types';

export const DIRECT_REF_KEY = 'hold_id';
const EXPECT = { app: STRIPE_APP_BOOK, purpose: STRIPE_PURPOSE_DIRECT_BOOKING, refKey: DIRECT_REF_KEY } as const;

type AnySchema = { schema: (s: string) => SupabaseClient };
const bookDb = (db: SupabaseClient) => (db as unknown as AnySchema).schema('book');

export class DirectPaymentError extends Error {
  constructor(
    message: string,
    public code = 'error',
    public status = 400
  ) {
    super(message);
  }
}

function db(): SupabaseClient {
  const c = partnerServiceClient();
  if (!c) throw new DirectPaymentError('オンライン決済は現在ご利用いただけません。', 'unavailable', 503);
  return c;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await bookDb(db()).rpc(name, args);
  if (error) throw new DirectPaymentError(error.message, codeOf(error.message), 400);
  return data as T;
}

// DB の例外文字列 → 画面で出し分けるコード
function codeOf(message: string): string {
  for (const c of ['hold_expired', 'forbidden', 'invalid_guest', 'prepay_not_allowed', 'already_paid', 'amount_too_small', 'amount_mismatch', 'invalid_locale']) {
    if (message.includes(c)) return c;
  }
  return 'error';
}

// ---------------------------------------------------------------------------
// 使えるか（鍵＋service_role＋migration）。migration の有無は isolate 内で5分キャッシュ
// ---------------------------------------------------------------------------
let probe: { at: number; ok: boolean } | null = null;
const PROBE_TTL_MS = 5 * 60 * 1000;

export async function directPaymentsReady(): Promise<boolean> {
  if (!inlinePaymentReady()) return false;
  const c = partnerServiceClient();
  if (!c) return false;
  if (probe && Date.now() - probe.at < PROBE_TTL_MS) return probe.ok;
  const { data, error } = await bookDb(c).rpc('direct_payment_available');
  const ok = !error && data === true;
  probe = { at: Date.now(), ok };
  return ok;
}

export const directPublishableKey = () => stripePublishableKey();

// 画面の明細用の入湯税（本人の仮押さえのときだけ・取れなければ 0）
export async function holdBathTax(holdId: string, sessionId: string, memberUserId: string | null): Promise<number> {
  const c = partnerServiceClient();
  if (!c) return 0;
  const { data, error } = await bookDb(c).rpc('direct_payment_bath_tax', {
    p_hold_id: holdId,
    p_session_id: sessionId,
    p_member_user_id: memberUserId
  });
  if (error) return 0;
  return Math.max(0, Number(data) || 0);
}

// ---------------------------------------------------------------------------
// ①② 支払の準備
// ---------------------------------------------------------------------------
export type DirectPrepared = {
  clientSecret: string;
  intentId: string;
  amount: number;
  lodging: number;
  bathTax: number;
  prepayDiscount: number;
  pointsUsed: number;
  expiresAt: string;
};

type PrepareRow = {
  hold_id: string;
  amount: number;
  lodging_amount: number;
  bath_tax_amount: number;
  prepay_discount?: number;
  points_used: number;
  total: number;
  payment_intent_id: string | null;
  expires_at: string;
  facility_id: string;
};

export async function prepareDirectPayment(args: {
  holdId: string;
  sessionId: string;
  memberUserId: string | null;
  guest: GuestInfo;
  pointsUsed: number;
  locale: string;
  facilityName: string;
  checkin: string;
}): Promise<DirectPrepared> {
  const row = await rpc<PrepareRow>('direct_payment_prepare', {
    p_hold_id: args.holdId,
    p_session_id: args.sessionId,
    p_member_user_id: args.memberUserId,
    p_guest: args.guest,
    p_points_used: args.pointsUsed,
    p_locale: args.locale
  });
  const metadata = buildIntentMetadata({
    app: STRIPE_APP_BOOK,
    purpose: STRIPE_PURPOSE_DIRECT_BOOKING,
    refs: { [DIRECT_REF_KEY]: row.hold_id, facility_id: row.facility_id, checkin: args.checkin }
  });
  const { prepared } = await preparePaymentIntent({
    existingId: row.payment_intent_id,
    amount: row.amount,
    description: `${args.facilityName} ご宿泊（${args.checkin} チェックイン・公式サイト予約）`,
    metadata,
    refKey: DIRECT_REF_KEY,
    // 同じ仮押さえで同時に2回押されても Intent が1本になるよう、仮押さえ・前回の Intent・金額から作る
    idempotencyKey: `book-direct-pi-${row.hold_id}-${row.payment_intent_id ?? 'first'}-${row.amount}`
  });
  if (prepared.intentId !== row.payment_intent_id) {
    await rpc('direct_payment_attach_intent', { p_hold_id: row.hold_id, p_payment_intent_id: prepared.intentId, p_amount: row.amount });
  }
  return {
    clientSecret: prepared.clientSecret,
    intentId: prepared.intentId,
    amount: row.amount,
    lodging: row.lodging_amount,
    bathTax: row.bath_tax_amount,
    prepayDiscount: row.prepay_discount ?? 0,
    pointsUsed: row.points_used,
    expiresAt: row.expires_at
  };
}

// ---------------------------------------------------------------------------
// ④ 確定（ブラウザからの連絡・3Dセキュアの戻り・Webhook）
// ---------------------------------------------------------------------------
export type DirectConfirmResult =
  | {
      result: 'paid' | 'already';
      holdId: string;
      bookingCode: string;
      total: number | null;
      pointsUsed: number | null;
      pointsEarned: number | null;
      discount: number | null;
      /** 予約時決済の割引額（20260926151458）。予約金額からは引いていない */
      prepayDiscount: number;
      amount: number;
      bathTax: number | null;
    }
  // 支払は通ったが予約にできなかった（期限切れ等）→ 全額返金した（refunded=false は返金に失敗＝要人手）
  | { result: 'late'; holdId: string; reason: string; refunded: boolean }
  // まだ支払が済んでいない（3Dセキュア待ち・処理中・拒否）
  | { result: 'not_succeeded'; holdId: string; status: string }
  | { result: 'not_ours' };

type ConfirmRow = {
  result: 'paid' | 'already' | 'late' | 'mismatch' | 'not_found';
  reason?: string;
  booking_code?: string;
  total?: number;
  points_used?: number;
  points_earned?: number;
  discount?: number;
  amount?: number;
  bath_tax_amount?: number;
  prepay_discount?: number;
};

// expectHoldId: ブラウザからの連絡のときは、画面の仮押さえの Intent であることも確かめる
export async function confirmDirectIntent(intentId: string, expectHoldId?: string): Promise<DirectConfirmResult> {
  if (!isPaymentIntentId(intentId)) return { result: 'not_ours' };
  const pi = await retrievePaymentIntent(intentId);
  const check = checkPaymentIntent(pi, { ...EXPECT, refId: expectHoldId, expectedAmount: null });
  if (!check.ok) {
    if (check.reason === 'not_succeeded') return { result: 'not_succeeded', holdId: check.refId, status: check.status };
    if (check.reason === 'amount_mismatch') throw new DirectPaymentError('通貨が違う決済です', 'amount_mismatch', 400);
    return { result: 'not_ours' };
  }
  const holdId = check.refId;
  const amount = pi.amount_received ?? pi.amount;
  const row = await rpc<ConfirmRow>('direct_payment_confirm', { p_hold_id: holdId, p_payment_intent_id: pi.id, p_amount: amount });

  if (row.result === 'paid' || row.result === 'already') {
    return {
      result: row.result,
      holdId,
      bookingCode: row.booking_code ?? '',
      total: row.total ?? null,
      pointsUsed: row.points_used ?? null,
      pointsEarned: row.points_earned ?? null,
      discount: row.discount ?? null,
      prepayDiscount: row.prepay_discount ?? 0,
      amount: row.amount ?? amount,
      bathTax: row.bath_tax_amount ?? null
    };
  }
  if (row.result === 'not_found') return { result: 'not_ours' };

  // late（期限切れ・金額の食い違い）/ mismatch（台帳と違う Intent・二重払い）→ この Intent を全額返金
  const reason = row.reason ?? row.result;
  const refunded = await refundWhole(pi.id, reason);
  return { result: 'late', holdId, reason, refunded };
}

async function refundWhole(intentId: string, reason: string): Promise<boolean> {
  try {
    const r = await createRefund(intentId, `book-direct-late-${intentId}`, { app: STRIPE_APP_BOOK, purpose: STRIPE_PURPOSE_DIRECT_BOOKING, reason: reason.slice(0, 200) });
    await rpc('direct_payment_record_refund', { p_payment_intent_id: intentId, p_refund_id: r.id, p_amount: r.amount, p_reason: `late:${reason}`.slice(0, 200) });
    return true;
  } catch (e) {
    // 台帳が無い（mismatch で別の Intent）なら記録は not_ours で何もしない。Stripe の返金自体の失敗は人に知らせる
    await rpc('direct_payment_mark_refund_failed', { p_payment_intent_id: intentId, p_error: e instanceof Error ? e.message : String(e) }).catch(() => {});
    console.error('[direct-payment] 全額返金に失敗', intentId, e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 取消後の返金（お客様・会員・管理画面のどの入口の取消からも呼ぶ。冪等）
// ---------------------------------------------------------------------------
export type DirectRefundOutcome =
  | { kind: 'none' } // オンライン決済の予約ではない（現地払い）
  | { kind: 'nothing_due'; paid: number; fee: number } // キャンセル料が支払額以上
  | { kind: 'refunded'; amount: number; paid: number; fee: number }
  | { kind: 'failed'; amount: number; paid: number; fee: number; message: string };

type RefundDueRow =
  | { result: 'none' | 'not_cancelled'; payment_intent_id?: string }
  | { result: 'due'; booking_id: string; payment_intent_id: string; amount: number; bath_tax_amount: number; fee: number; refunded: number; due: number };

export async function refundAfterCancel(bookingCode: string, reason: string): Promise<DirectRefundOutcome> {
  if (!partnerServiceClient()) return { kind: 'none' };
  let due: RefundDueRow;
  try {
    due = await rpc<RefundDueRow>('direct_payment_refund_due', { p_booking_code: bookingCode });
  } catch {
    // migration 未適用の環境（オンライン決済の予約が存在しない）
    return { kind: 'none' };
  }
  if (due.result !== 'due') return { kind: 'none' };
  if (due.due <= 0) return { kind: 'nothing_due', paid: due.amount, fee: due.fee };
  try {
    // 冪等キーは「予約・返金済み額」で作る（同じ取消で2回呼ばれても1回だけ返金）
    const r = await createRefund(
      due.payment_intent_id,
      `book-direct-cancel-${due.booking_id}-${due.refunded}`,
      { app: STRIPE_APP_BOOK, purpose: STRIPE_PURPOSE_DIRECT_BOOKING, booking_code: bookingCode },
      due.due
    );
    await rpc('direct_payment_record_refund', {
      p_payment_intent_id: due.payment_intent_id,
      p_refund_id: r.id,
      p_amount: r.amount ?? due.due,
      p_reason: `cancel:${reason}`.slice(0, 200)
    });
    return { kind: 'refunded', amount: r.amount ?? due.due, paid: due.amount, fee: due.fee };
  } catch (e) {
    const message = e instanceof StripeError || e instanceof Error ? e.message : String(e);
    await rpc('direct_payment_mark_refund_failed', { p_payment_intent_id: due.payment_intent_id, p_error: message }).catch(() => {});
    console.error('[direct-payment] 取消の返金に失敗', bookingCode, message);
    return { kind: 'failed', amount: due.due, paid: due.amount, fee: due.fee, message };
  }
}

// 取消の前に見せる返金の見込み（支払額・キャンセル料は画面側で持っている）
export type DirectPaymentInfo = {
  hold_id: string;
  booking_code: string | null;
  status: 'pending' | 'paid' | 'late';
  amount: number;
  lodging_amount: number;
  bath_tax_amount: number;
  /** 予約時決済の割引額（20260926151458 より前の行は無い） */
  prepay_discount_amount?: number;
  points_used: number;
  payment_intent_id: string | null;
  paid_at: string | null;
  refunded_amount: number;
  refund_status: 'none' | 'partial' | 'full' | 'failed';
  refunds: { id: string; amount: number; reason: string | null; at: string }[];
  refund_error: string | null;
  last_error: string | null;
};

export async function directPaymentForBooking(bookingCode: string): Promise<DirectPaymentInfo | null> {
  const c = partnerServiceClient();
  if (!c) return null;
  const { data, error } = await bookDb(c).rpc('direct_payment_get', { p_booking_code: bookingCode });
  if (error || !data) return null;
  return data as DirectPaymentInfo;
}

// ---------------------------------------------------------------------------
// Webhook: Stripe の管理画面からの返金の同期（charge.refunded）。返金 id で冪等
// ---------------------------------------------------------------------------
export async function syncDirectRefundFromStripe(charge: { payment_intent?: unknown }): Promise<'recorded' | 'already' | 'not_ours'> {
  const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (!intent) return 'not_ours';
  const c = partnerServiceClient();
  if (!c) return 'not_ours';
  const { data, error } = await bookDb(c).rpc('direct_payment_get', { p_payment_intent_id: intent });
  if (error || !data) return 'not_ours';
  const refunds = await listRefunds(intent);
  let recorded = false;
  for (const r of refunds.data) {
    if (r.status !== 'succeeded') continue;
    const res = await rpc<{ result: string }>('direct_payment_record_refund', {
      p_payment_intent_id: intent,
      p_refund_id: r.id,
      p_amount: r.amount,
      p_reason: 'stripe_dashboard'
    });
    if (res.result === 'recorded') recorded = true;
  }
  return recorded ? 'recorded' : 'already';
}

// 返金をやり直す（管理画面の「返金を再実行」。取消済みで返金が残っている予約だけ）
export const retryDirectRefund = (bookingCode: string) => refundAfterCancel(bookingCode, 'staff_retry');
