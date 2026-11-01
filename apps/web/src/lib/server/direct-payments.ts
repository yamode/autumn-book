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
import { refundCancelledUpgrades } from './upgrade-payments';
import {
  cardLabelOf,
  chargeSavedCard,
  createCustomer,
  createRefund,
  inlinePaymentReady,
  isStripeResourceMissing,
  listRefunds,
  retrievePaymentIntent,
  retrieveSetupIntent,
  STRIPE_APP_BOOK,
  STRIPE_PURPOSE_DIRECT_BOOKING,
  stripePublishableKey,
  StripeError
} from '$lib/server/stripe';
import { buildIntentMetadata } from '$lib/server/payments/metadata';
import { preparePaymentIntent, prepareSetupIntent } from '$lib/server/payments/intents';
import { createSavedCardSession, listSavedCards, resolveMemberCustomer } from '$lib/server/payments/saved-cards';
import { checkPaymentIntent, checkSetupIntent, isPaymentIntentId, isSetupIntentId } from '$lib/server/payments/verify';
import { cardExpiresBefore } from '$lib/partner-card';
import type { GuestInfo, RatePlan } from '$lib/types';
import { addDays } from '@autumn-book/core';
import { directRefundDueOf } from '$lib/direct-payment';
import { deductionOf, type KeptReason } from '$lib/cancel-admin-fee';
import { DATA_SOURCE } from '$lib/server/supabase';
import { MEMBER_SUPABASE } from '$lib/server/auth';
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

// 会員の保存カードの Customer（読むだけ・無い／読めなければ null）。会員ログインが Supabase のときだけ
async function memberSavedCardCustomer(userId: string): Promise<string | null> {
  const c = partnerServiceClient();
  if (!c || !MEMBER_SUPABASE) return null;
  return resolveMemberCustomer(c, { userId, name: null, email: null }, { create: false }).catch(() => null);
}

/**
 * 予約確認（/booking/hold）の決済部品に会員の保存カードを出す CustomerSession（2026-10-07・§6.4）。
 * 会員の Customer が無い・保存カードが無い・失敗のときは null（従来どおり新しいカードの入力だけ）。
 */
export async function directMemberCustomerSession(userId: string): Promise<string | null> {
  const customer = await memberSavedCardCustomer(userId);
  if (!customer) return null;
  try {
    if (!(await listSavedCards(customer)).length) return null;
    return (await createSavedCardSession(customer)).clientSecret;
  } catch (e) {
    console.warn('[direct-payments] 保存カードを出せません:', e instanceof Error ? e.message : e);
    return null;
  }
}

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
  // 複数室は rooms（部屋ごとの男女・回答）を足す（DB の direct_payment_confirm が p_rooms_detail に渡す・M1）
  guest: GuestInfo & { rooms?: { male?: number; female?: number; notes?: string; answers?: Record<string, string> }[] };
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
  // 保存カード（2026-10-07・docs/saved-cards.md §7.6）: 会員の Customer があれば Intent に付ける（予約確認の「保存済み」から選べる）
  const customer = args.memberUserId ? await memberSavedCardCustomer(args.memberUserId) : null;
  const { prepared } = await preparePaymentIntent({
    existingId: row.payment_intent_id,
    customer,
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
// ①② オンライン決済（チェックアウト日）: カード登録の準備（2026-11-01・取引先ページのチェックアウト日決済と同じ考え方）
//   予約時に SetupIntent でカードを登録（本人認証もここ）→ direct_payment_confirm_setup で予約を確定（未請求）
//   → チェックアウト日に chargeDueDirect（/api/cron/partner-charge に相乗り）が off-session で請求する。
//   予約時決済の割引・早期決済ポイント・事務手数料は付けない（DB の direct_payment_prepare_checkout）。
// ---------------------------------------------------------------------------
export type DirectSetupPrepared = {
  clientSecret: string;
  intentId: string;
  /** チェックアウト日に請求する予定の額（宿泊料金 − ポイント ＋ 入湯税） */
  amount: number;
  bathTax: number;
  pointsUsed: number;
  /** 請求日（チェックアウト日） */
  chargeOn: string;
  consentText: string;
  expiresAt: string;
};

type PrepareCheckoutRow = PrepareRow & { setup_intent_id: string | null; stripe_customer_id: string | null; checkout_date: string };

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

/** カード登録の同意文（画面に出し、SetupIntent の metadata にも残す） */
export function directCardConsentText(facilityName: string, chargeOn: string, amount: number, bathTax: number): string {
  const [y, m, d] = chargeOn.split('-').map(Number);
  return (
    `${facilityName}のご宿泊について、チェックアウト日の ${y}年${m}月${d}日に、このカードへ ${yen(amount)}` +
    `${bathTax > 0 ? `（入湯税 ${yen(bathTax)} を含む）` : ''}を請求することに同意します。` +
    'ご予約の変更で金額が変わった場合は変更後の金額を、キャンセル料がかかる日に取り消した場合はキャンセル料を、このカードへ請求します。'
  );
}

export async function prepareDirectCheckout(args: {
  holdId: string;
  sessionId: string;
  memberUserId: string | null;
  guest: GuestInfo & { rooms?: { male?: number; female?: number; notes?: string; answers?: Record<string, string> }[] };
  pointsUsed: number;
  locale: string;
  facilityName: string;
  checkin: string;
  /** 画面に出していた請求予定額。DB の額と違えば止める */
  expectedAmount?: number | null;
}): Promise<DirectSetupPrepared> {
  const row = await rpc<PrepareCheckoutRow>('direct_payment_prepare_checkout', {
    p_hold_id: args.holdId,
    p_session_id: args.sessionId,
    p_member_user_id: args.memberUserId,
    p_guest: args.guest,
    p_points_used: args.pointsUsed,
    p_locale: args.locale
  });
  if (args.expectedAmount != null && Number.isFinite(args.expectedAmount) && args.expectedAmount !== row.amount) {
    throw new DirectPaymentError(`画面の請求額 ${args.expectedAmount} と DB の請求額 ${row.amount} が違います`, 'amount_changed', 409);
  }
  const consentText = directCardConsentText(args.facilityName, row.checkout_date, row.amount, row.bath_tax_amount);
  // Customer: 会員は会員の Customer（保存カードから選べる・無ければ作る）。非会員は仮押さえごとに作る
  const bookingCustomer = async (suffix = '') =>
    (
      await createCustomer({
        name: args.guest.name || 'ゲスト',
        email: args.guest.email || null,
        metadata: { app: STRIPE_APP_BOOK, purpose: STRIPE_PURPOSE_DIRECT_BOOKING, [DIRECT_REF_KEY]: row.hold_id },
        idempotencyKey: `book-direct-customer-${row.hold_id}${suffix}`
      })
    ).id;
  let customer = row.stripe_customer_id;
  if (!customer && args.memberUserId && MEMBER_SUPABASE) {
    customer = await resolveMemberCustomer(db(), { userId: args.memberUserId, name: args.guest.name, email: args.guest.email }, { create: true }).catch(() => null);
  }
  if (!customer) customer = await bookingCustomer();
  const metadata = buildIntentMetadata({
    app: STRIPE_APP_BOOK,
    purpose: STRIPE_PURPOSE_DIRECT_BOOKING,
    refs: { [DIRECT_REF_KEY]: row.hold_id, facility_id: row.facility_id, checkin: args.checkin, charge_on: row.checkout_date, charge_amount: String(row.amount) }
  });
  const setup = (cus: string, suffix = '') =>
    prepareSetupIntent({
      existingId: row.setup_intent_id,
      customer: cus,
      description: `${args.facilityName} ご宿泊（${args.checkin} チェックイン・公式サイト予約）${row.checkout_date} チェックアウト日に ${yen(row.amount)} を請求`,
      metadata: { ...metadata, consent_text: consentText.slice(0, 500) },
      refKey: DIRECT_REF_KEY,
      idempotencyKey: `book-direct-si-${row.hold_id}-${row.setup_intent_id ?? 'first'}-${cus}${suffix}`
    });
  let r: Awaited<ReturnType<typeof setup>>;
  try {
    r = await setup(customer);
  } catch (e) {
    // Customer が Stripe 側で消えていた → 仮押さえごとの Customer を作り直す
    if (!isStripeResourceMissing(e)) throw e;
    const missing = customer;
    customer = await bookingCustomer(`-${missing}`);
    r = await setup(customer, `-${missing}`);
  }
  if (r.prepared.intentId !== row.setup_intent_id || customer !== row.stripe_customer_id) {
    await rpc('direct_payment_attach_setup', { p_hold_id: row.hold_id, p_setup_intent_id: r.prepared.intentId, p_customer: customer });
  }
  return {
    clientSecret: r.prepared.clientSecret,
    intentId: r.prepared.intentId,
    amount: row.amount,
    bathTax: row.bath_tax_amount,
    pointsUsed: row.points_used,
    chargeOn: row.checkout_date,
    consentText,
    expiresAt: row.expires_at
  };
}

type ConfirmSetupRow = Omit<ConfirmRow, 'result'> & { charge_on?: string; result: ConfirmRow['result'] | 'scheduled' };

/**
 * カード登録の完了（ブラウザからの連絡・3Dセキュアの戻り・Webhook setup_intent.succeeded）→ 予約を確定（未請求）。
 * 結果は予約時決済と同じ形（result: 'paid' | 'already'）で返し、chargeOn に請求日を入れる。お金は動いていないので late でも返金しない。
 */
export async function confirmDirectSetup(
  setupIntentId: string,
  expectHoldId?: string
): Promise<DirectConfirmResult | { result: 'card_expiry'; holdId: string }> {
  if (!isSetupIntentId(setupIntentId)) return { result: 'not_ours' };
  const si = await retrieveSetupIntent(setupIntentId, true);
  const check = checkSetupIntent(si, { ...EXPECT, refId: expectHoldId });
  if (!check.ok) {
    if (check.reason === 'not_succeeded') return { result: 'not_succeeded', holdId: check.refId, status: check.status };
    return { result: 'not_ours' };
  }
  const holdId = check.refId;
  const pm = si.payment_method && typeof si.payment_method === 'object' ? si.payment_method : null;
  const chargeOn = si.metadata?.charge_on ?? '';
  // 有効期限が請求日（チェックアウト日）より前に切れるカードは登録しない（別のカードを登録してもらう）
  if (chargeOn && cardExpiresBefore(pm?.card, chargeOn)) return { result: 'card_expiry', holdId };
  const customer = typeof si.customer === 'string' ? si.customer : (si.customer?.id ?? '');
  const pmId = pm?.id ?? (typeof si.payment_method === 'string' ? si.payment_method : '');
  const row = await rpc<ConfirmSetupRow>('direct_payment_confirm_setup', {
    p_hold_id: holdId,
    p_setup_intent_id: si.id,
    p_customer: customer,
    p_payment_method: pmId,
    p_card_label: cardLabelOf(pm)
  });
  if (row.result === 'scheduled' || row.result === 'already') {
    return {
      result: row.result === 'scheduled' ? 'paid' : 'already',
      holdId,
      bookingCode: row.booking_code ?? '',
      total: row.total ?? null,
      pointsUsed: row.points_used ?? null,
      pointsEarned: row.points_earned ?? null,
      discount: row.discount ?? null,
      prepayDiscount: 0,
      amount: row.amount ?? 0,
      bathTax: row.bath_tax_amount ?? null,
      chargeOn: row.charge_on ?? chargeOn
    };
  }
  if (row.result === 'not_found' || row.result === 'mismatch') return { result: 'not_ours' };
  // 仮押さえの期限切れ等: カードを登録しただけでお金は動いていない（返金不要）
  return { result: 'late', holdId, reason: row.reason ?? row.result, refunded: true, noCharge: true };
}

// ---------------------------------------------------------------------------
// オンライン決済（チェックアウト日）の請求（定期処理・取消・管理画面の再請求）
// ---------------------------------------------------------------------------
type ClaimRow =
  | { result: 'skip'; reason: string }
  | { result: 'void'; amount: number; booking_code: string | null }
  | {
      result: 'claimed';
      hold_id: string;
      booking_id: string;
      booking_code: string;
      facility_id: string;
      customer: string;
      payment_method: string;
      setup_intent_id: string | null;
      attempt: number;
      amount: number;
      cancelled: boolean;
    };

export type DirectChargeResult = { status: 'paid' | 'failed' | 'void' | 'skipped'; amount?: number; message?: string };

function friendlyChargeError(e: unknown): string {
  if (!(e instanceof StripeError)) return e instanceof Error ? e.message : String(e);
  const reasons: Record<string, string> = {
    authentication_required: 'カード会社の本人認証が必要なため、自動で請求できませんでした',
    insufficient_funds: 'カードの利用可能額が不足しています',
    expired_card: 'カードの有効期限が切れています',
    card_declined: 'カードが利用できませんでした（カード会社が承認しませんでした）',
    processing_error: 'カード会社との通信でエラーが起きました（時間をおいて再請求してください）'
  };
  return (e.code && reasons[e.code]) || e.message;
}

/** 1 件請求する（予約から請求額を計算・二重請求は DB の charging で防ぐ）。trigger: cron / cancel / staff */
export async function chargeDirectBooking(holdId: string, trigger: 'cron' | 'cancel' | 'staff'): Promise<DirectChargeResult> {
  // 取消の直後の請求（キャンセル料）は全室取消のときだけ（1 室だけの取消はチェックアウト日にまとめて請求）
  const claim = await rpc<ClaimRow>('direct_payment_claim_charge', { p_hold_id: holdId, p_cancelled_only: trigger === 'cancel' });
  if (claim.result === 'skip') return { status: 'skipped', message: claim.reason };
  if (claim.result === 'void') return { status: 'void', amount: claim.amount };
  let failure: string | null = null;
  let intentId: string | null = null;
  try {
    const pi = await chargeSavedCard({
      customer: claim.customer,
      paymentMethod: claim.payment_method,
      amount: claim.amount,
      description: `${claim.cancelled ? 'キャンセル料' : 'ご宿泊'}（${claim.booking_code}・公式サイト予約）`,
      metadata: {
        app: STRIPE_APP_BOOK,
        purpose: STRIPE_PURPOSE_DIRECT_BOOKING,
        [DIRECT_REF_KEY]: claim.hold_id,
        booking_code: claim.booking_code,
        facility_id: claim.facility_id,
        flow: 'checkout_charge',
        trigger,
        ...(claim.setup_intent_id ? { setup_intent: claim.setup_intent_id } : {})
      },
      idempotencyKey: `book-direct-charge-${claim.hold_id}-${claim.attempt}`
    });
    intentId = pi.id;
    if (pi.status !== 'succeeded') failure = `請求が完了しませんでした（${pi.status}）`;
  } catch (e) {
    failure = friendlyChargeError(e);
  }
  if (failure) {
    await rpc('direct_payment_mark_charge_failed', { p_hold_id: claim.hold_id, p_error: failure }).catch(() => {});
    console.error('[direct-payment] チェックアウト日決済の請求に失敗', claim.booking_code, failure);
    return { status: 'failed', amount: claim.amount, message: failure };
  }
  try {
    await rpc('direct_payment_mark_charged', { p_hold_id: claim.hold_id, p_payment_intent_id: intentId, p_amount: claim.amount });
  } catch (e) {
    // 請求そのものは成功している。記録の失敗は人に知らせる（台帳は charging のまま＝再請求されない）
    console.error('[direct-payment] 請求の記録に失敗（請求は成功）', claim.booking_code, intentId, e instanceof Error ? e.message : e);
  }
  return { status: 'paid', amount: claim.amount };
}

/** 定期処理（毎時・/api/cron/partner-charge）: チェックアウト日を迎えた未請求の予約に請求する。失敗は自動では再請求しない */
export async function chargeDueDirect(): Promise<{ target: number; paid: number; failed: number; skipped: number }> {
  const out = { target: 0, paid: 0, failed: 0, skipped: 0 };
  if (!partnerServiceClient()) return out;
  const ids = await rpc<string[]>('direct_payment_due_charges', { p_today: todayJstIso(), p_limit: 50 }).catch(() => [] as string[]);
  out.target = ids.length;
  for (const id of ids) {
    const r = await chargeDirectBooking(id, 'cron').catch((e) => ({ status: 'failed' as const, message: String(e) }));
    out[r.status === 'paid' ? 'paid' : r.status === 'failed' ? 'failed' : 'skipped'] += 1;
  }
  return out;
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
      /** オンライン決済（チェックアウト日）: 請求日。予約時決済は無い */
      chargeOn?: string;
    }
  // 支払は通ったが予約にできなかった（期限切れ等）→ 全額返金した（refunded=false は返金に失敗＝要人手）。
  // noCharge: チェックアウト日決済のカード登録だけで、お金は動いていない
  | { result: 'late'; holdId: string; reason: string; refunded: boolean; noCharge?: boolean }
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
  // チェックアウト日決済の請求（chargeDirectBooking が作る off-session の Intent）は予約の確定ではない。
  // Webhook が記録より先に届くと「台帳と違う Intent」で全額返金してしまうので、ここでは扱わない
  if (pi.metadata?.flow === 'checkout_charge') return { result: 'not_ours' };
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
// reason = 差し引いた額の理由（cancel_fee / prepay_discount / admin_fee / none）。adminFee / adminFeePercent = 事務手数料（2026-10-07・
// autumn-shared 20261007010002 より前の DB・率の無い予約は 0 / null）
type RefundExtra = { reason: KeptReason; adminFee: number; adminFeePercent: number | null };
export type DirectRefundOutcome =
  | { kind: 'none' } // オンライン決済の予約ではない（現地払い）
  // オンライン決済（チェックアウト日）で未請求の予約を全室取り消した: キャンセル料を登録カードへ請求した結果（返金は無い）
  | { kind: 'checkout_fee'; status: DirectChargeResult['status']; amount: number; message?: string }
  | ({ kind: 'nothing_due'; paid: number; fee: number; kept: number } & RefundExtra) // 差し引く額が支払額以上
  | ({ kind: 'refunded'; amount: number; paid: number; fee: number; kept: number } & RefundExtra)
  | ({ kind: 'failed'; amount: number; paid: number; fee: number; kept: number; message: string } & RefundExtra);

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
      /** 事務手数料（20261007010002 から） */
      admin_fee_percent?: number | null;
      admin_fee_waived?: boolean;
      admin_fee?: number;
      kept_reason?: KeptReason;
      fee: number;
      refunded: number;
      due: number;
      /** 1 室ずつ取り消した予約の式で計算したか（autumn-shared 20261010204933 から） */
      partial?: boolean;
      /** 生きている部屋の支払分の和（partial のとき） */
      live_share?: number;
    };

const keptOf = (due: { prepay_discount_kept?: number }) => Math.max(0, Number(due.prepay_discount_kept) || 0);
const extraOf = (due: { admin_fee?: number; admin_fee_percent?: number | null; kept_reason?: KeptReason; fee: number; prepay_discount_kept?: number }): RefundExtra => ({
  reason: due.kept_reason ?? (keptOf(due) > 0 ? 'prepay_discount' : due.fee > 0 ? 'cancel_fee' : 'none'),
  adminFee: Math.max(0, Number(due.admin_fee) || 0),
  adminFeePercent: due.admin_fee_percent == null ? null : Number(due.admin_fee_percent)
});

/**
 * 管理画面の取消で「事務手数料も免除」を選んだとき、返金の前に支払の記録へ印を付ける（autumn-shared 20261007010002）。
 * DB が古い・オンライン決済の予約でないときは何もしない（false）。
 */
export async function setDirectAdminFeeWaived(bookingCode: string, waived: boolean): Promise<boolean> {
  if (!partnerServiceClient()) return false;
  try {
    return (await rpc<boolean>('direct_payment_set_admin_fee_waived', { p_booking_code: bookingCode, p_waived: waived })) === true;
  } catch {
    return false;
  }
}

/**
 * 取消のあとの返金（DB の direct_payment_refund_due が「今あるべき返金額の累計 − 返金済み」を返す）。
 * opts.roomIndex: 1 室だけ取り消したとき（複数室 M2）。返金の記録（refunds[]）と電文 refunded に部屋の番号を付ける。
 * 冪等キーは「予約・返金済み額」なので、1 室ずつ取り消して 2 回目の返金をしても別のキーになる。
 */
export async function refundAfterCancel(
  bookingCode: string,
  reason: string,
  opts: { roomIndex?: number } = {}
): Promise<DirectRefundOutcome> {
  try { await refundCancelledUpgrades(bookingCode); } catch { console.error('[upgrade-refund] retry required; reconciliation will retry'); }
  if (!partnerServiceClient()) return { kind: 'none' };
  // オンライン決済（チェックアウト日）でまだ請求していない予約: 返金は無い。全室取消ならキャンセル料を登録カードへ請求する
  // （0 円なら void。1 室だけの取消は DB が断り、チェックアウト日にまとめて請求する）
  const ledger = await directPaymentForBooking(bookingCode);
  if (ledger?.charge_timing === 'checkout' && (ledger.status === 'scheduled' || ledger.status === 'charge_failed')) {
    const r = await chargeDirectBooking(ledger.hold_id, 'cancel').catch((e) => ({ status: 'failed' as const, message: String(e) }) as DirectChargeResult);
    if (r.status === 'skipped') return { kind: 'none' };
    return { kind: 'checkout_fee', status: r.status, amount: r.amount ?? 0, message: r.message };
  }
  let due: RefundDueRow;
  try {
    due = await rpc<RefundDueRow>('direct_payment_refund_due', { p_booking_code: bookingCode });
  } catch {
    // migration 未適用の環境（オンライン決済の予約が存在しない）
    return { kind: 'none' };
  }
  if (due.result !== 'due') return { kind: 'none' };
  const kept = keptOf(due);
  const extra = extraOf(due);
  if (due.due <= 0) return { kind: 'nothing_due', paid: due.amount, fee: due.fee, kept, ...extra };
  try {
    // 冪等キーは「予約・返金済み額・今回の返金額」（同じ取消で 2 回呼ばれても同じキー＝1 回だけ返金。1 室ずつ取り消した次の返金は別のキー）
    const r = await createRefund(
      due.payment_intent_id,
      `book-direct-cancel-${due.booking_id}-${due.refunded}-${due.due}`,
      {
        app: STRIPE_APP_BOOK,
        purpose: STRIPE_PURPOSE_DIRECT_BOOKING,
        booking_code: bookingCode,
        ...(opts.roomIndex != null ? { room_index: String(opts.roomIndex) } : {})
      },
      due.due
    );
    await rpc('direct_payment_record_refund', {
      p_payment_intent_id: due.payment_intent_id,
      p_refund_id: r.id,
      p_amount: r.amount ?? due.due,
      p_reason: `cancel:${reason}${opts.roomIndex != null ? `:room${opts.roomIndex}` : ''}`.slice(0, 200),
      // 部屋の番号つきの 5 引数版（autumn-shared 20261010204933）。予約全体の返金は従来の 4 引数版
      ...(opts.roomIndex != null ? { p_room_index: opts.roomIndex } : {})
    });
    return { kind: 'refunded', amount: r.amount ?? due.due, paid: due.amount, fee: due.fee, kept, ...extra };
  } catch (e) {
    const message = e instanceof StripeError || e instanceof Error ? e.message : String(e);
    await rpc('direct_payment_mark_refund_failed', { p_payment_intent_id: due.payment_intent_id, p_error: message }).catch(() => {});
    console.error('[direct-payment] 取消の返金に失敗', bookingCode, message);
    return { kind: 'failed', amount: due.due, paid: due.amount, fee: due.fee, kept, message, ...extra };
  }
}

// 取消の前に見せる返金の見込み（支払額・キャンセル料は画面側で持っている）
export type DirectPaymentInfo = {
  hold_id: string;
  booking_code: string | null;
  /** scheduled / charging / charge_failed / void はオンライン決済（チェックアウト日・20261101133553）だけ */
  status: 'pending' | 'paid' | 'late' | 'scheduled' | 'charging' | 'charge_failed' | 'void';
  /** 請求の時期（now＝予約時決済 / checkout＝チェックアウト日。20261101133553 より前の行は無い＝now） */
  charge_timing?: 'now' | 'checkout';
  card_label?: string | null;
  charge_error?: string | null;
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
  /** 予約時の事務手数料の率（%・20261007010002 から。導入前の行は null＝事務手数料なし） */
  cancel_admin_fee_percent?: number | null;
  cancel_admin_fee_waived?: boolean;
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
 *   fee: 規定のキャンセル料（支払額まで）／ discount: 予約時決済の割引額 ／ adminFee: 事務手数料（支払額 × 予約時の率）
 *   deducted: 実際に差し引く額（いちばん大きい方）／ kept: 規定のキャンセル料を超えて差し引く分 ／ refund: 返金額
 *   reason: 差し引く額の理由
 * waived（施設都合＝キャンセル料免除）のときは割引額も差し引かない。事務手数料は adminFeeWaived のときだけ差し引かない。
 */
export type DirectRefundPreview = {
  paid: number;
  fee: number;
  discount: number;
  deducted: number;
  kept: number;
  refund: number;
  adminFee: number;
  adminFeePercent: number | null;
  reason: KeptReason;
};

export function directRefundPreviewOf(
  pay: Pick<DirectPaymentInfo, 'amount' | 'prepay_discount_amount' | 'refunded_amount'> & {
    bath_tax_amount?: number;
    cancel_admin_fee_percent?: number | null;
    cancel_admin_fee_waived?: boolean;
  },
  ruleFee: number,
  waived = false,
  adminFeeWaived = pay.cancel_admin_fee_waived === true
): DirectRefundPreview {
  const paid = pay.amount;
  const bathTax = Math.max(0, pay.bath_tax_amount ?? 0);
  const discount = Math.max(0, pay.prepay_discount_amount ?? 0);
  const rule = waived ? 0 : Math.max(0, ruleFee);
  const adminFeePercent = pay.cancel_admin_fee_percent == null ? null : Number(pay.cancel_admin_fee_percent);
  const refund = directRefundDueOf({
    amount: paid,
    fee: rule,
    refunded: pay.refunded_amount,
    prepayDiscount: discount,
    waived,
    bathTax,
    adminFeePercent,
    adminFeeWaived
  });
  // 返金しない割引額・事務手数料は「入湯税を除いた支払額」まで（入湯税は必ず返す・DB の direct_payment_refund_due と同じ）
  const d = deductionOf({ paid, bathTax, fee: rule, discount: waived ? 0 : discount, adminFeePercent, adminFeeWaived });
  const fee = Math.min(rule, paid);
  return { paid, fee, discount, deducted: d.kept, kept: Math.max(0, d.kept - fee), refund, adminFee: d.adminFee, adminFeePercent, reason: d.reason };
}

/**
 * 取消済みの予約の返金の内訳（管理画面用・DB の direct_payment_refund_due をそのまま読む）。
 * 取消前・現地払い・移行前の環境なら null。kept（返金しない割引額）は 20260926221912 より前の DB では 0。
 */
export async function directRefundDueFor(
  bookingCode: string
): Promise<
  ({ cancellationFee: number | null; prepayDiscount: number; kept: number; fee: number; due: number } & RefundExtra & { adminFeeWaived: boolean }) | null
> {
  if (!partnerServiceClient()) return null;
  try {
    const d = await rpc<RefundDueRow>('direct_payment_refund_due', { p_booking_code: bookingCode });
    if (d.result !== 'due') return null;
    return {
      cancellationFee: d.cancellation_fee ?? null,
      prepayDiscount: Math.max(0, Number(d.prepay_discount) || 0),
      kept: keptOf(d),
      fee: d.fee,
      due: d.due,
      ...extraOf(d),
      adminFeeWaived: d.admin_fee_waived === true
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
 * 複数室の予約入力（docs/official-multi-room.md §8.3・M1）: 部屋ごとの予約時決済の割引をまとめた表示。
 *   割引額・早期決済ポイントは部屋ごとの額の和（DB の direct_payment_prepare も部屋ごとに計算して足す）。
 *   段階表は出す部屋のもの（段は施設で 1 つ・残り日数は全室同じ）。「あと N 日で下がる」は部屋ごとに違うので出さない。
 *   mixedRates: 割引の当たった部屋どうしで率が違う（割引行の名前に率を出さない）。
 * 1 室は部屋の表示そのもの（従来と同じ）。
 */
export function combinePrepayViews(views: PrepayDiscountView[]): PrepayDiscountView & { mixedRates: boolean } {
  if (views.length <= 1) return { ...views[0], mixedRates: false };
  const base = views.find((v) => v.showLadder) ?? views[0];
  const hit = views.filter((v) => v.detail.discount > 0);
  const rates = new Set(hit.map((v) => v.detail.maxPermille));
  const max = (f: (v: PrepayDiscountView) => number) => views.reduce((mx, v) => Math.max(mx, f(v)), 0);
  return {
    ...base,
    showLadder: views.some((v) => v.showLadder),
    early: views.some((v) => v.early),
    drop: null,
    detail: {
      ...base.detail,
      discount: views.reduce((s, v) => s + v.detail.discount, 0),
      bonusPoints: views.reduce((s, v) => s + v.detail.bonusPoints, 0),
      maxPermille: max((v) => v.detail.maxPermille),
      pointsPermille: max((v) => v.detail.pointsPermille),
      flatPermille: rates.size > 1 ? 0 : (hit[0]?.detail.flatPermille ?? base.detail.flatPermille),
      blackoutNights: max((v) => v.detail.blackoutNights)
    },
    mixedRates: rates.size > 1
  };
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

/**
 * 閲覧者が会員か（非会員の支払方法 book.plan_contents.nonmember_payment_method の切替に使う）。
 * 実データは会員ログイン（MEMBER_SUPABASE）で book.members に行がある人＝role 'member'。デモは role 'member'。
 * 予約確認・決済 API・プラン一覧／詳細で同じ判定を使う（DB の direct_payment_prepare も会員行の有無で判定）。
 */
export function viewerIsMember(locals: { user?: { role?: string } | null }): boolean {
  if (locals.user?.role !== 'member') return false;
  return DATA_SOURCE === 'supabase' ? MEMBER_SUPABASE : true;
}
