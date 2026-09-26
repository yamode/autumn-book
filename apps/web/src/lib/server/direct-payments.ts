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
import type { GuestInfo, RatePlan } from '$lib/types';
import { addDays } from '@autumn-book/core';
import { directRefundDueOf } from '$lib/direct-payment';
import {
  nextTierDrop,
  prepayDiscountDetail,
  tierPermilleOf,
  todayJstIso,
  type EarlyPrepayMode,
  type EarlyPrepaySettings,
  type PrepayDiscountDetail
} from '$lib/early-prepay';
import { loadEarlyPrepaySettings } from '$lib/server/payment-settings';

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
  for (const c of ['hold_expired', 'forbidden', 'invalid_guest', 'prepay_not_allowed', 'already_paid', 'amount_too_small', 'amount_mismatch', 'amount_changed', 'invalid_locale']) {
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
  /** 割引の内訳（20260926221912 より前の DB は無い＝null） */
  prepayDetail: PrepayDetailSummary | null;
  pointsUsed: number;
  expiresAt: string;
};

/** 完了画面の割引・上乗せポイントの表示に使う内訳（DB の prepay_discount_detail から） */
export type PrepayDetailSummary = {
  /** 当たった泊の割引率の最大（千分率） */
  maxPermille: number;
  /** 早期決済割（段階表）が定率より大きく割引として当たったか（discount のときだけ） */
  early: boolean;
  /** 除外期間の泊があり、泊ごとに率が違う */
  mixed: boolean;
  /** 還元方法（20260926225536 より前の DB は無い＝discount） */
  mode?: EarlyPrepayMode;
  /** 宿泊後に上乗せする早期決済ポイント（points のときだけ） */
  bonusPoints?: number;
  /** 早期決済ポイントの率の最大（千分率） */
  pointsPermille?: number;
};

export function detailSummaryOf(raw: unknown): PrepayDetailSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const max = Number(d.max_permille);
  if (!Number.isFinite(max)) return null;
  const mode: EarlyPrepayMode = d.mode === 'points' ? 'points' : 'discount';
  const tier = Number(d.tier_permille) || 0;
  const flat = Number(d.flat_permille) || 0;
  const black = Number(d.blackout_nights) || 0;
  // points のときは段階表の率は割引にならない（割引はプランの定率だけ）
  const early = mode === 'discount' && tier > flat;
  return {
    maxPermille: max,
    early,
    mixed: black > 0 && early,
    mode,
    bonusPoints: mode === 'points' ? Math.max(0, Math.floor(Number(d.bonus_points) || 0)) : 0,
    pointsPermille: mode === 'points' ? Math.max(0, Number(d.points_permille) || 0) : 0
  };
}

/** 台帳（direct_payments.prepay_discount_detail）から早期決済ポイントの数（points 以外・旧 DB は 0） */
export function prepayBonusPointsOf(pay: Pick<DirectPaymentInfo, 'prepay_discount_detail'> | null | undefined): number {
  const d = detailSummaryOf(pay?.prepay_discount_detail);
  return d?.mode === 'points' ? (d.bonusPoints ?? 0) : 0;
}

type PrepareRow = {
  hold_id: string;
  amount: number;
  lodging_amount: number;
  bath_tax_amount: number;
  prepay_discount?: number;
  /** 20260926221912 から。旧 DB は無い */
  prepay_discount_detail?: unknown;
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
  /**
   * 画面に出していた請求額。DB が決めた額（割引は DB の prepay_discount が正）と違えば Intent を作らずに止める
   * （日付が変わって早期決済割の段が下がった等。画面側の「金額が違えば払わせない」と同じ扱いを、Intent を作る前にサーバでも行う）
   */
  expectedAmount?: number | null;
}): Promise<DirectPrepared> {
  const row = await rpc<PrepareRow>('direct_payment_prepare', {
    p_hold_id: args.holdId,
    p_session_id: args.sessionId,
    p_member_user_id: args.memberUserId,
    p_guest: args.guest,
    p_points_used: args.pointsUsed,
    p_locale: args.locale
  });
  if (args.expectedAmount != null && Number.isFinite(args.expectedAmount) && args.expectedAmount !== row.amount) {
    throw new DirectPaymentError(
      `画面の請求額 ${args.expectedAmount} と DB の請求額 ${row.amount}（割引 ${row.prepay_discount ?? 0}）が違います`,
      'amount_changed',
      409
    );
  }
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
    prepayDetail: detailSummaryOf(row.prepay_discount_detail),
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
// fee = 差し引いた額（規定のキャンセル料と返金しない割引額の大きい方）。kept = そのうち規定のキャンセル料を超えた分
// （＝返金しない予約時決済の割引額。20260926221912 より前の DB は 0）
export type DirectRefundOutcome =
  | { kind: 'none' } // オンライン決済の予約ではない（現地払い）
  | { kind: 'nothing_due'; paid: number; fee: number; kept: number } // 差し引く額が支払額以上
  | { kind: 'refunded'; amount: number; paid: number; fee: number; kept: number }
  | { kind: 'failed'; amount: number; paid: number; fee: number; kept: number; message: string };

type RefundDueRow =
  | { result: 'none' | 'not_cancelled'; payment_intent_id?: string }
  | {
      result: 'due';
      booking_id: string;
      payment_intent_id: string;
      amount: number;
      bath_tax_amount: number;
      /** 規定のキャンセル料（20260926221912 から） */
      cancellation_fee?: number;
      prepay_discount?: number;
      prepay_discount_kept?: number;
      fee: number;
      refunded: number;
      due: number;
    };

const keptOf = (due: { prepay_discount_kept?: number }) => Math.max(0, Number(due.prepay_discount_kept) || 0);

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
  const kept = keptOf(due);
  if (due.due <= 0) return { kind: 'nothing_due', paid: due.amount, fee: due.fee, kept };
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
    return { kind: 'refunded', amount: r.amount ?? due.due, paid: due.amount, fee: due.fee, kept };
  } catch (e) {
    const message = e instanceof StripeError || e instanceof Error ? e.message : String(e);
    await rpc('direct_payment_mark_refund_failed', { p_payment_intent_id: due.payment_intent_id, p_error: message }).catch(() => {});
    console.error('[direct-payment] 取消の返金に失敗', bookingCode, message);
    return { kind: 'failed', amount: due.due, paid: due.amount, fee: due.fee, kept, message };
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
  /** 割引・上乗せポイントの内訳（20260926221912 から。mode / bonus_points は 20260926225536 から） */
  prepay_discount_detail?: unknown;
  /** 早期決済ポイントを付与した日時（20260926225536 から・未付与は null） */
  prepay_bonus_granted_at?: string | null;
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

/**
 * 取消前の返金の見込み（画面用。式は DB の direct_payment_refund_due と同じ lib/direct-payment.ts の directRefundDueOf）。
 *   fee: 規定のキャンセル料（支払額まで）／ discount: 予約時決済の割引額 ／ deducted: 実際に差し引く額（大きい方）
 *   kept: 規定のキャンセル料を超えて差し引く分（＝返金しない割引額）／ refund: 返金額
 * waived（施設都合＝キャンセル料免除）のときは割引額も差し引かない（全額返金）。
 */
export type DirectRefundPreview = { paid: number; fee: number; discount: number; deducted: number; kept: number; refund: number };

export function directRefundPreviewOf(
  pay: Pick<DirectPaymentInfo, 'amount' | 'prepay_discount_amount' | 'refunded_amount'> & { bath_tax_amount?: number },
  ruleFee: number,
  waived = false
): DirectRefundPreview {
  const paid = pay.amount;
  const bathTax = Math.max(0, pay.bath_tax_amount ?? 0);
  const discount = Math.max(0, pay.prepay_discount_amount ?? 0);
  const rule = waived ? 0 : Math.max(0, ruleFee);
  const refund = directRefundDueOf({ amount: paid, fee: rule, refunded: pay.refunded_amount, prepayDiscount: discount, waived, bathTax });
  const fee = Math.min(rule, paid);
  // 返金しない割引額は「入湯税を除いた支払額」まで（入湯税は必ず返す・DB の direct_payment_refund_due と同じ）
  const deducted = waived ? fee : Math.max(fee, Math.min(discount, Math.max(paid - bathTax, 0)));
  return { paid, fee, discount, deducted, kept: Math.max(0, deducted - fee), refund };
}

/**
 * 取消済みの予約の返金の内訳（管理画面用・DB の direct_payment_refund_due をそのまま読む）。
 * 取消前・現地払い・移行前の環境なら null。kept（返金しない割引額）は 20260926221912 より前の DB では 0。
 */
export async function directRefundDueFor(
  bookingCode: string
): Promise<{ cancellationFee: number | null; prepayDiscount: number; kept: number; fee: number; due: number } | null> {
  if (!partnerServiceClient()) return null;
  try {
    const d = await rpc<RefundDueRow>('direct_payment_refund_due', { p_booking_code: bookingCode });
    if (d.result !== 'due') return null;
    return {
      cancellationFee: d.cancellation_fee ?? null,
      prepayDiscount: Math.max(0, Number(d.prepay_discount) || 0),
      kept: keptOf(d),
      fee: d.fee,
      due: d.due
    };
  } catch {
    return null;
  }
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

// ---------------------------------------------------------------------------
// 早期決済割の表示（予約確認画面・デモ決済画面・プラン一覧）。式は lib/early-prepay.ts（DB と同じ）
// ---------------------------------------------------------------------------
export type PrepayDiscountView = {
  /**
   * 還元方法。discount = 早期決済割（請求額から割引）/ points = 早期決済ポイント（宿泊後に上乗せ付与）。
   * 施設で OFF・対象外のプランは discount（定率割引だけ）
   */
  mode: EarlyPrepayMode;
  /** 段階表（日数の昇順）。早期決済割・ポイントを見せないときは空 */
  tiers: { days: number; percent: number }[];
  /**
   * 段階表を画面に出すか（施設で ON・プランが対象・
   * discount は段階表の最大が定率より大きい／points は定率割引と別に付くので段階表があれば出す）
   */
  showLadder: boolean;
  detail: PrepayDiscountDetail;
  /** 早期決済割（段階表）が定率より大きく割引として当たったか（割引行の名前を「早期決済割」にする。points では常に false） */
  early: boolean;
  /**
   * 境界の7日以内: あと inDays 日で fromPercent% → toPercent% に下がる。
   * diff は discount なら割引額の差（円）、points なら早期決済ポイントの差（pt）
   */
  drop: { inDays: number; fromPercent: number; toPercent: number; diff: number } | null;
};

type HoldLike = { checkin: string; quote: { total: number; lines?: { date: string; subtotal: number }[] } };

export function prepayDiscountViewOf(
  settings: EarlyPrepaySettings,
  plan: Pick<RatePlan, 'payment'>,
  hold: HoldLike,
  today = todayJstIso()
): PrepayDiscountView {
  const eligible = plan.payment.prepay && plan.payment.earlyPrepay === true && settings.enabled && settings.tiers.length > 0;
  const input = {
    total: hold.quote.total,
    lines: hold.quote.lines,
    checkIn: hold.checkin,
    today,
    flatRate: plan.payment.prepay ? plan.payment.prepayDiscountRate : 0,
    earlyEligible: eligible,
    settings
  };
  const detail = prepayDiscountDetail(input);
  const tiers = eligible ? [...settings.tiers].sort((a, b) => a.days - b.days) : [];
  const maxTier = tiers.reduce((mx, t) => Math.max(mx, Math.round(t.percent * 10)), 0);
  const points = detail.mode === 'points';
  // points は定率割引と別に付く（重ならない）ので、定率と比べない
  const showLadder = eligible && (points ? maxTier > 0 : maxTier > detail.flatPermille);
  let drop: PrepayDiscountView['drop'] = null;
  if (showLadder && detail.tierPermille > (points ? 0 : detail.flatPermille)) {
    const d = nextTierDrop(tiers, detail.leadDays);
    if (d) {
      // 段が下がった日に予約した場合との差（割引額 or ポイント）。定率の方が大きくなる等で差が 0 なら出さない
      const later = prepayDiscountDetail({ ...input, today: addDays(today, d.inDays) });
      const diff = points ? detail.bonusPoints - later.bonusPoints : detail.discount - later.discount;
      if (diff > 0) drop = { ...d, diff };
    }
  }
  return {
    mode: detail.mode,
    tiers,
    showLadder,
    detail,
    early: !points && detail.tierPermille > detail.flatPermille && detail.discount > 0,
    drop
  };
}

export async function prepayDiscountViewFor(facilityId: string, plan: Pick<RatePlan, 'payment'>, hold: HoldLike): Promise<PrepayDiscountView> {
  const settings = await loadEarlyPrepaySettings(facilityId);
  return prepayDiscountViewOf(settings, plan, hold);
}

/**
 * プラン一覧・詳細用: 対象プランの payment.earlyPrepayMaxRate に「予約時決済で最大 N%」の N（0〜0.2）を入れる。
 * payment.earlyPrepayMode に施設の還元方法も入れる。
 *   discount: 段階表の最大率が定率（prepayDiscountRate）より大きいときだけ（小さければ定率の表示のまま）
 *   points:   定率割引とは別に付くので、段階表があれば入れる（定率の表示と並べて出す）
 * 元のプランは書き換えない（デモの store はプランを共有しているため）。
 */
export function withEarlyPrepayMax<T extends Pick<RatePlan, 'payment'>>(plans: T[], settings: EarlyPrepaySettings): T[] {
  const maxTier = settings.enabled ? tierPermilleOf(settings.tiers, Number.MAX_SAFE_INTEGER) : 0;
  if (maxTier <= 0) return plans;
  return plans.map((p) => {
    if (!p.payment.prepay || p.payment.earlyPrepay !== true) return p;
    const flat = Math.round((p.payment.prepayDiscountRate || 0) * 1000);
    if (settings.mode !== 'points' && maxTier <= flat) return p;
    return { ...p, payment: { ...p.payment, earlyPrepayMaxRate: maxTier / 1000, earlyPrepayMode: settings.mode } };
  });
}
