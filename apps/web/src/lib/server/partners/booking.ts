// 取引先予約: 見積もり（特別レートでの料金と残室）・確定・一覧・取消・通知メール。
//
// 予約の作成と取消は autumn-shared の DB 関数（public.rms_partner_create_booking / rms_partner_cancel_booking）が
// 1トランザクションで行い、直販予約と同じ電文で PMS へ届ける（migration 20260926054852）。
// ここは「取引先に見せた料金で・受付ルールの範囲で」受け付けるための前後の処理を持つ。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyPrepayDiscount,
  chargeAmountOf,
  canBookFor,
  DEPOSIT_PAYMENT_LABEL,
  DEPOSIT_PAYMENT_NOTE,
  DEPOSIT_PAYMENT_OPTION,
  depositAmountOf,
  depositRemainderModeOf,
  depositRemainderText,
  depositStateOf,
  describeCreditDeposit,
  firstNightLodgingOf,
  intentAmountOf,
  isDepositPaymentOption,
  isDepositRemainderBilled,
  PARTNER_PAYMENT_OPTIONS,
  describePrepayDiscount,
  hasPrepayDiscount,
  isStripePaymentOption,
  paymentOptionLabel,
  canPartnerCancel,
  describeDeadline,
  normalizeBooker,
  partnerPlanName,
  perksForPlan,
  resolveTransport,
  validateBooker,
  type PartnerBooker,
  type PartnerBookingGuestInput
} from '$lib/partner-booking';
import { buildBookingExtras, extraOptionRows, extraSummaryLines, partnerMailRecipients, splitExtraOptions, type BookingExtras } from './booking-extras';
import { partnerMailSender, sendFacilityNotice, sendPartnerMail } from './mail';
import { isBillablePaymentOption } from '$lib/partner-invoice';
import { genderText, resolveQuestionAnswers, resolveRoomGenders } from '$lib/booking-questions';
import { loadStandardFieldTexts, partnerBookingForm } from '../booking-questions';
import {
  cancelPolicyTable,
  invoiceMonthLabel,
  partnerRefundOf,
  planCancelPolicy,
  quoteCancelFee,
  readCancelPolicy,
  settlementOf,
  settlementText,
  storeCancelPolicy,
  type CancelPolicy,
  type CancelSettlement,
  type PartnerRefund
} from '$lib/partner-cancel-fee';
import {
  cardLabelOf,
  chargeSavedCard,
  createCustomer,
  createRefund,
  inlinePaymentReady,
  listRefunds,
  onlinePaymentReady,
  retrieveCheckoutSession,
  retrievePaymentIntent,
  retrieveSetupIntent,
  STRIPE_APP,
  STRIPE_PURPOSE_PARTNER_BOOKING,
  isStripeResourceMissing,
  StripeError,
  stripeTestMode,
  type StripePaymentMethod
} from '$lib/server/stripe';
import { buildIntentMetadata } from '$lib/server/payments/metadata';
import { preparePaymentIntent, prepareSetupIntent, type PreparedIntent } from '$lib/server/payments/intents';
import { checkPaymentIntent, checkSetupIntent, idOf, isPaymentIntentId, isSetupIntentId } from '$lib/server/payments/verify';
import { cardExpiresBefore } from '$lib/partner-card';
import { resolvePartnerCustomer } from '$lib/server/payments/saved-cards';
import { addDaysIso, loadPartnerContextAt, logPartnerAccess, partnerCreditCheck, PartnerStoreError, pmsGuestFormalNames, saveBookerProfile, todayJst, type PartnerContext, type PartnerRow } from './store';
import { bookingNameLine, normalizeBookingNameMode, type BookingNameMode } from '$lib/pms-partner-guest';
import { creditDepositNotice, creditOverLine, creditOverSubjectPrefix, requiresDeposit, showsCredit, stayRoomNightsByMonth, type CreditCheck } from '$lib/partner-credit';
import { clampPartnerRange, loadPartnerRates, PARTNER_MAX_RANGE_DAYS } from './rates';
import { loadCancelAdminFeePercent } from '../payment-settings';
import { readAdminFeeTerms } from '$lib/cancel-admin-fee';
import { bookingAttachmentNames, partnerBookingAttachmentsEnabled } from './booking-attachments';
import { attachmentLine } from '$lib/partner-attachments';

type AnySchema = { schema: (s: string) => SupabaseClient };
const pmsDb = (db: SupabaseClient) => (db as unknown as AnySchema).schema('pms');
const coreDb = (db: SupabaseClient) => (db as unknown as AnySchema).schema('core');

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

// ---------------------------------------------------------------------------
// 予約の施設で合成した取引先（複数施設化・docs/partner-multi-facility.md §7.9・2026-10-09）
// ---------------------------------------------------------------------------

/**
 * 予約・取消・請求・メールのように「台帳の予約から施設が決まる」処理用: 取引先をその予約の施設（台帳の facility_id）で
 * 合成し直す。渡された取引先が既にその施設で合成済みならそのまま返す（取引先ページで選んでいる施設・管理画面の施設とは限らない）。
 */
export async function contextForBooking(
  db: SupabaseClient,
  partner: Pick<PartnerRow, 'id'> & Partial<PartnerContext>,
  booking: Pick<PartnerBookingRow, 'facility_id'>
): Promise<PartnerContext> {
  if (partner.facility_id === booking.facility_id && partner.facility_name && partner.facility_slug && partner.facilities && partner.booking_settings) {
    return partner as PartnerContext;
  }
  const ctx = await loadPartnerContextAt(db, partner.id, booking.facility_id);
  if (!ctx) throw new PartnerStoreError('予約の施設の取引先設定が見つかりません。', 404, 'not_found');
  return ctx;
}

/** 予約一覧用: 予約の施設ごとに合成した取引先（施設 id → 合成）。読めない施設は入れない（呼び出し側が選んでいる施設で代える） */
export async function contextsForBookings(
  db: SupabaseClient,
  partner: PartnerContext,
  rows: readonly Pick<PartnerBookingRow, 'facility_id'>[]
): Promise<Map<string, PartnerContext>> {
  const out = new Map<string, PartnerContext>([[partner.facility_id, partner]]);
  const ids = [...new Set(rows.map((r) => r.facility_id).filter((id) => id && !out.has(id)))];
  await Promise.all(
    ids.map(async (id) => {
      const ctx = await contextForBooking(db, partner, { facility_id: id }).catch(() => null);
      if (ctx) out.set(id, ctx);
    })
  );
  return out;
}

/** 取引先の施設の名前（予約一覧で予約ごとの施設名を出す）。知らない施設なら選んでいる施設の名前 */
export const partnerFacilityName = (partner: Pick<PartnerContext, 'facilities' | 'facility_name'>, facilityId: string | null | undefined) =>
  partner.facilities.find((f) => f.id === facilityId)?.name ?? partner.facility_name;
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------------------------------------------------------------------------
// 支払方法・受付状態
// ---------------------------------------------------------------------------

// オンライン決済（Stripe）は STRIPE_SECRET_KEY と PUBLIC_STRIPE_PUBLISHABLE_KEY がそろっているときだけ使える
// （inlinePaymentReady）。無ければ設定で許可していても取引先の画面には出さない（銀行振込だけの取引先はそのまま予約できる）。
// 自動請求（cron）はシークレットキーだけで動く（onlinePaymentReady）。
export { inlinePaymentReady, onlinePaymentReady };

// 取引先が予約時に選べる支払方法（設定で許可したもののうち、いま使えるもの）。
export function availablePaymentOptions(partner: Pick<PartnerRow, 'booking_settings'>): string[] {
  return partner.booking_settings.paymentOptions.filter((id) => !isStripePaymentOption(id) || inlinePaymentReady());
}

// 限定URLから予約できる状態か（受付オン・使える支払方法が1つ以上）。
export function isPartnerBookingOpen(partner: Pick<PartnerRow, 'booking_enabled' | 'booking_settings'>): boolean {
  return partner.booking_enabled && availablePaymentOptions(partner).length > 0;
}

// 受付枠（与信）を超えたときにだけ使える支払方法（Phase 3b・決定 #2）。超過時の挙動が deposit で、紐づけがあり、
// Stripe を画面に出せるときだけ。取引先の paymentOptions に online が無くても、超過時は全額の予約時決済も選べる。
export function creditOverPaymentOptions(partner: Pick<PartnerRow, 'credit_over_action' | 'pms_guest_id'>): string[] {
  if (partner.credit_over_action !== 'deposit' || !partner.pms_guest_id || !inlinePaymentReady()) return [];
  return ['online', DEPOSIT_PAYMENT_OPTION];
}

/**
 * 予約で使う支払方法を決める（予約画面の確定・/book/reserve・createPartnerBooking で共通）。
 * 取引先が選んだもの（使えるもの・超過時だけの online / deposit_online を含む）→ 無ければ、支払方法が1つだけならそれ。
 * overOnly: 取引先の通常の支払方法には無く、受付枠を超えたときだけ選べるもの（確定前に超過かを確かめる）。
 */
export function resolvePaymentOption(
  partner: Pick<PartnerRow, 'booking_settings' | 'credit_over_action' | 'pms_guest_id'>,
  requested: string | null | undefined
): { option: string; overOnly: boolean } | null {
  const base = availablePaymentOptions(partner);
  const req = String(requested ?? '');
  if (req && base.includes(req) && !isDepositPaymentOption(req)) return { option: req, overOnly: false };
  if (req && creditOverPaymentOptions(partner).includes(req)) return { option: req, overOnly: true };
  return base.length === 1 ? { option: base[0], overOnly: false } : null;
}

// 予約画面に出す支払方法の1つ（billable: 請求書払い＝宿泊料金・入湯税は取引先へ請求）
export type QuotePaymentChoice = { id: string; label: string; note: string; billable: boolean };

// デポジット（超過時・deposit）の見積。額は DB 関数と同じ規則で計算した見込み（確定時は DB が計算し直す）
export type QuoteDeposit = {
  amount: number;
  remainder: number;
  remainderBilled: boolean;
  remainderText: string;
  basis: string;
  notice: string;
};

// ---------------------------------------------------------------------------
// 見積もり
// ---------------------------------------------------------------------------

export type BookingTarget = {
  roomCode: string;
  planCode: string;
  planName: string;
  checkIn: string;
  nights: number;
  rooms: { adults: number }[];
};

// 入湯税（PMS の施設設定 pms.facility_billing_settings と同じ規則: 1人1泊の額 × 人泊・子供を含めるかは設定）。
// 取引先予約は大人のみなので、額 × 大人の合計 × 泊数。PMS は請求書に同じ額の入湯税の明細を自動で起こす。
async function bathTaxRule(db: SupabaseClient, facilityId: string): Promise<{ enabled: boolean; amount: number }> {
  const { data } = await pmsDb(db)
    .from('facility_billing_settings')
    .select('bath_tax_enabled, bath_tax_amount')
    .eq('facility_id', facilityId)
    .maybeSingle();
  return { enabled: !!data?.bath_tax_enabled, amount: Math.max(0, Math.round(Number(data?.bath_tax_amount) || 0)) };
}

// オンライン決済で請求する額（宿泊料金＋入湯税）。キャンセル料の基準は宿泊料金（total_amount）だけ。
// 計算は lib/partner-booking.ts（画面と共通の純関数）
export { chargeAmountOf };

export type BookingQuote =
  | {
      ok: true;
      roomCode: string;
      roomName: string;
      planCode: string;
      planName: string;
      mealType: string | null;
      advance: boolean;
      checkIn: string;
      checkOut: string;
      nights: number;
      rooms: { adults: number; nights: { date: string; unit_price: number }[]; subtotal: number }[];
      total: number;
      // 入湯税（宿泊料金と一緒に請求する。キャンセル料の基準には含めない）
      bathTax: number;
      // 予約時決済（online）を選んだときの割引後の金額。割引の設定が無い・予約時決済を使えない取引先は null。
      prepay: { total: number; discount: number; label: string } | null;
      // 部屋タイプの残室（PMS と同じ規則）。取れなければ null。
      remaining: number | null;
      // 御社の受付枠（与信・Phase 3a）: 紐づけ先が与信 ON の旅行会社のときだけ。滞在が触る月ごとの判定（この予約ぶんを足した後）。
      // 見積の画面（予約入力・料金の再計算）でだけ読む（確定時は DB 関数が判定し直す）。
      credit: PartnerQuoteCredit | null;
      // 受付枠を超え、超過時の挙動が deposit のとき（Phase 3b）: 支払方法の選択肢の差し替え（online と deposit_online だけ）と
      // デポジットの額・残額。それ以外は null（取引先の通常の支払方法のまま）。
      paymentChoices: QuotePaymentChoice[] | null;
      deposit: QuoteDeposit | null;
    }
  | { ok: false; message: string };

export type PartnerQuoteCredit = Pick<CreditCheck, 'over' | 'months'>;

/**
 * 滞在の受付枠（与信）。紐づけ先が無い・与信を見ない（ignore）・旅行会社でない・与信 OFF なら null。
 * p_add はこの予約の延べ室数（室数 × その月の泊数）。Phase 3a では超えても止めない（warn / deposit とも表示だけ）。
 * 受付枠は補助の表示なので、読めなくても見積・予約は止めない（null）。
 */
export async function partnerStayCredit(
  db: SupabaseClient,
  partner: Pick<PartnerRow, 'pms_guest_id' | 'facility_id' | 'credit_over_action'>,
  checkIn: string,
  nights: number,
  roomCount: number
): Promise<PartnerQuoteCredit | null> {
  if (!partner.pms_guest_id || !showsCredit(partner.credit_over_action)) return null;
  const add = stayRoomNightsByMonth(checkIn, nights, roomCount);
  const months = Object.keys(add);
  if (!months.length) return null;
  try {
    const c = await partnerCreditCheck(db, partner, months, add);
    return c?.enabled ? { over: c.over, months: c.months } : null;
  } catch (e) {
    console.error('[partner-credit] 受付枠を読めませんでした:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function roomTypeRemaining(
  db: SupabaseClient,
  facilityId: string,
  roomCode: string,
  from: string,
  toExclusive: string
): Promise<{ roomTypeId: string | null; min: number | null }> {
  const { data: rt } = await pmsDb(db)
    .from('room_types')
    .select('id')
    .eq('facility_id', facilityId)
    .eq('code', roomCode)
    .eq('is_active', true)
    .maybeSingle();
  const roomTypeId = (rt?.id as string | undefined) ?? null;
  if (!roomTypeId) return { roomTypeId: null, min: null };
  const { data, error } = await db.rpc('rms_partner_room_type_remaining', {
    p_facility_id: facilityId,
    p_room_type_id: roomTypeId,
    p_from: from,
    p_to: toExclusive
  });
  if (error || !Array.isArray(data)) return { roomTypeId, min: null };
  const rows = data as { night_date: string; remaining: number }[];
  return { roomTypeId, min: rows.length ? Math.min(...rows.map((r) => r.remaining)) : null };
}

// opts.credit: 受付枠（与信）も読む（予約入力の画面・料金の再計算のとき）。確定（createPartnerBooking）では読まない
export async function quotePartnerBooking(db: SupabaseClient, partner: PartnerContext, t: BookingTarget, opts: { credit?: boolean } = {}): Promise<BookingQuote> {
  const nights = Math.round(t.nights);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.checkIn) || !(nights >= 1) || nights > PARTNER_MAX_RANGE_DAYS) {
    return { ok: false, message: '宿泊日・泊数が正しくありません。' };
  }
  if (!t.rooms.length || t.rooms.some((r) => !Number.isInteger(r.adults) || r.adults < 1 || r.adults > 20)) {
    return { ok: false, message: '人数が正しくありません。' };
  }
  const lastNight = addDaysIso(t.checkIn, nights - 1);
  const range = clampPartnerRange(partner, t.checkIn, lastNight);
  if (!range || range.from !== t.checkIn || range.to !== lastNight) {
    return { ok: false, message: 'ご案内できる期間を超えています。宿泊日・泊数をご確認ください。' };
  }
  const guests = [...new Set(t.rooms.map((r) => r.adults))];
  const [rates, remaining, bathRule, credit] = await Promise.all([
    loadPartnerRates(db, partner, { from: range.from, to: range.to }, { rooms: [t.roomCode], guests }),
    roomTypeRemaining(db, partner.facility_id, t.roomCode, t.checkIn, addDaysIso(lastNight, 1)),
    bathTaxRule(db, partner.facility_id),
    opts.credit ? partnerStayCredit(db, partner, t.checkIn, nights, t.rooms.length) : Promise.resolve(null)
  ]);

  let roomName = t.roomCode;
  let mealType: string | null = null;
  let advance = false;
  const byDate = new Map(rates.days.map((d) => [d.date, d]));
  const rooms: { adults: number; nights: { date: string; unit_price: number }[]; subtotal: number }[] = t.rooms.map((r) => ({
    adults: r.adults,
    nights: [],
    subtotal: 0
  }));
  for (let i = 0; i < nights; i += 1) {
    const date = addDaysIso(t.checkIn, i);
    const day = byDate.get(date);
    if (!day || day.closed) return { ok: false, message: `${date} は休館日のため、ご予約いただけません。` };
    const room = day.rooms.find((r) => r.roomCode === t.roomCode);
    const plan = room?.plans.find((p) => p.planCode === t.planCode && p.planName === t.planName);
    if (!room || !plan) return { ok: false, message: `${date} はこのお部屋・プランをご案内できません。宿泊日を変えてお試しください。` };
    roomName = room.roomName;
    mealType = plan.mealType;
    advance = plan.advance;
    for (const r of rooms) {
      const unit = plan.pricesPerPerson[String(r.adults)];
      if (unit == null) return { ok: false, message: `${date} は ${r.adults}名1室 の料金がありません。人数を変えてお試しください。` };
      r.nights.push({ date, unit_price: unit });
      r.subtotal += unit * r.adults;
    }
  }
  const total = rooms.reduce((s, r) => s + r.subtotal, 0);
  const d = partner.booking_settings.prepayDiscount;
  const prepayTotal =
    hasPrepayDiscount(d) && availablePaymentOptions(partner).includes('online') ? discountRooms(rooms, d).reduce((s, r) => s + r.subtotal, 0) : null;
  const bathTax = bathRule.enabled ? bathRule.amount * rooms.reduce((s, r) => s + r.adults, 0) * nights : 0;
  // 受付枠を超え、超過時の挙動が deposit（Phase 3b）: 後払いを外し、全額の予約時決済とデポジットだけにする
  let paymentChoices: QuotePaymentChoice[] | null = null;
  let deposit: QuoteDeposit | null = null;
  if (credit && requiresDeposit(partner.credit_over_action, credit)) {
    const s = partner.booking_settings;
    const amount = depositAmountOf(s.creditDeposit, { lodging: total, bathTax, rooms: rooms.length, nights, firstNight: firstNightLodgingOf(rooms, t.checkIn) });
    const remainderBilled = depositRemainderModeOf(s) === 'invoice';
    const online = PARTNER_PAYMENT_OPTIONS.find((o) => o.id === 'online')!;
    paymentChoices = creditOverPaymentOptions(partner).map((id) =>
      id === 'online'
        ? { id, label: online.label, note: online.note, billable: false }
        : { id, label: DEPOSIT_PAYMENT_LABEL, note: DEPOSIT_PAYMENT_NOTE, billable: false }
    );
    deposit = {
      amount,
      remainder: Math.max(0, total + bathTax - amount),
      remainderBilled,
      remainderText: depositRemainderText(remainderBilled),
      basis: describeCreditDeposit(s.creditDeposit),
      notice: creditDepositNotice(credit.months, amount)
    };
  }
  return {
    ok: true,
    roomCode: t.roomCode,
    roomName,
    planCode: t.planCode,
    planName: t.planName,
    mealType,
    advance,
    checkIn: t.checkIn,
    checkOut: addDaysIso(lastNight, 1),
    nights,
    rooms,
    total,
    bathTax,
    prepay: prepayTotal == null ? null : { total: prepayTotal, discount: total - prepayTotal, label: describePrepayDiscount(d) },
    remaining: remaining.min,
    credit,
    paymentChoices,
    deposit
  };
}

type QuoteRoom = { adults: number; nights: { date: string; unit_price: number }[]; subtotal: number };

// 予約時決済の割引を泊ごとの1名単価に当てる（PMS の宿泊明細＝単価×人数 と請求額が一致するように）。
function discountRooms(rooms: QuoteRoom[], d: PartnerContext['booking_settings']['prepayDiscount']): QuoteRoom[] {
  return rooms.map((r) => {
    const nights = r.nights.map((n) => ({ date: n.date, unit_price: applyPrepayDiscount(n.unit_price, d) }));
    return { adults: r.adults, nights, subtotal: nights.reduce((s, n) => s + n.unit_price * r.adults, 0) };
  });
}

// ---------------------------------------------------------------------------
// 確定
// ---------------------------------------------------------------------------

export type CreateBookingInput = BookingTarget & {
  paymentOption: string;
  // 予約者（取引先のご担当者）。予約確認・取消・決済のメールの宛先（宿泊者へは送らない）
  booker: PartnerBooker;
  // 「この内容をマイページに保存する」（予約を受け付けたら rms_partner_accounts.booker_profile を上書き）
  saveBooker?: boolean;
  // 交通手段（任意）。id = jr / car / other、other は「その他」の自由入力
  transport: { id: string; other: string };
  guest: PartnerBookingGuestInput;
  arrival: string;
  notes: string;
  answers: Record<string, string>;
  // 部屋ごとの男女の内訳（male_<i> / female_<i>）。聞くかはプランの設定（book.plan_contents.ask_gender）
  genders?: Record<string, string>;
  // JR のときのお迎え時間（施設の「毎回聞く項目」に選択肢があるときだけ聞く）
  pickupTime?: string;
  // 予約入力で仮置きした添付ファイルの id（2026-10-07）。RPC が同じ取引先・同じログインIDの未束縛の行だけを結ぶ
  attachmentIds?: string[];
};

// payment があれば、オンライン決済の仮押さえ（同じ画面で支払・カード登録を済ませると予約確定・PMS へ）。
export type CreatedBooking = { id: string; bookingCode: string; total: number; emailed: boolean; payment?: PreparedPartnerPayment };

const PHONE_RE = /^[0-9+\-() ]{8,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function friendlyRpcError(message: string): string {
  const m = message.match(/sold_out:(\d{4}-\d{2}-\d{2}):(\d+)/);
  if (m) return `${m[1]} は満室になりました（残り ${m[2]} 室）。室数・日程を変えてお試しください。`;
  // 受付枠（与信）を超えたときのデポジット方式（Phase 3b・autumn-shared 20261007002617）
  if (message.includes('credit_over_requires_deposit')) {
    return '御社の受付枠を超えたため、このご予約は後払いではお受けできなくなりました。全額の予約時決済かデポジットでのお支払いをお選びください。';
  }
  if (message.includes('deposit_not_required')) return '受付枠に空きができたため、デポジットは不要になりました。お支払方法を選び直してください。';
  if (message.includes('invalid_payment_option')) return 'お支払方法を選び直してください。';
  if (message.includes('booking_disabled') || message.includes('facility_not_enabled')) return '現在ご予約を受け付けていません。';
  if (message.includes('past_date')) return '過去の日付はご予約いただけません。';
  if (message.includes('invalid_adults')) return '1室あたりの人数がお部屋の定員を超えています。';
  if (message.includes('guest_name_required')) return 'ご宿泊者のお名前を入力してください。';
  if (message.includes('guest_phone_required')) return 'ご宿泊者の電話番号を入力してください。';
  if (message.includes('invalid_email')) return 'メールアドレスの形式が正しくありません。';
  if (message.includes('room_type_not_found')) return 'このお部屋は現在ご予約いただけません。';
  if (message.includes('channel_not_found') || message.includes('does not exist') || message.includes('Could not find')) {
    return '予約の受付準備ができていません（宿へお問い合わせください）。';
  }
  return 'ご予約を確定できませんでした。時間をおいてもう一度お試しください。';
}

// 作成直後の台帳 detail に予約者・交通手段・特典と、取引先向けのプラン名（予約時点）を足す（DB 関数が作った detail を読み、マージして書き戻す）。
// service_role で触るので id と partner_id の両方で絞る。失敗しても予約は有効（PMS へは options で届いている）。
async function attachBookingExtras(db: SupabaseClient, partnerId: string, bookingId: string, extras: BookingExtras, planDisplayName: string): Promise<void> {
  const { data } = await db.from('rms_partner_bookings').select('detail').eq('id', bookingId).eq('partner_id', partnerId).maybeSingle();
  if (!data) return;
  const detail = {
    ...((data.detail as Record<string, unknown> | null) ?? {}),
    booker: extras.booker,
    transport: extras.transport || null,
    perks: extras.perks,
    plan_display_name: planDisplayName
  };
  const { error } = await db.from('rms_partner_bookings').update({ detail }).eq('id', bookingId).eq('partner_id', partnerId);
  if (error) console.error('[partner-booking] 予約者情報を台帳に書けませんでした:', error.message);
}

export async function createPartnerBooking(
  db: SupabaseClient,
  partner: PartnerContext,
  account: { id: string; login_id: string },
  input: CreateBookingInput,
  meta: { ip: string | null; origin: string }
): Promise<CreatedBooking> {
  const s = partner.booking_settings;
  // オンの施設が無い（N9）・この施設で受付をしていない
  if (!partner.facility_available || !partner.booking_enabled) throw new PartnerStoreError('現在ご予約を受け付けていません。', 403);
  const payOptions = availablePaymentOptions(partner);
  if (!payOptions.length) throw new PartnerStoreError('予約の受付準備ができていません（宿へお問い合わせください）。', 409);
  // 取引先が選んだもの（許可されたもの・受付枠を超えたときだけの online / deposit_online を含む）。1つだけならそれ。
  const resolved = resolvePaymentOption(partner, input.paymentOption);
  if (!resolved) throw new PartnerStoreError('お支払方法を選んでください。');
  const paymentOption = resolved.option;
  if (resolved.overOnly) {
    // 超過時だけの支払方法: 今も受付枠を超えているかを確かめる（最終の判定は DB 関数が施設ロックの中でやり直す）
    const credit = await partnerStayCredit(db, partner, input.checkIn, Math.round(input.nights), input.rooms.length);
    if (!credit) {
      // 受付枠を読めなかった（空いたとは限らない）
      throw new PartnerStoreError('受付枠を確認できませんでした。少し時間をおいて、お支払方法を選び直してください。', 409);
    }
    if (!requiresDeposit(partner.credit_over_action, credit)) {
      throw new PartnerStoreError('受付枠に空きができたため、通常のお支払方法でご予約いただけます。お支払方法を選び直してください。', 409);
    }
  }
  if (!canBookFor(input.checkIn, s)) {
    throw new PartnerStoreError(`この宿泊日のご予約は締め切りました（宿泊日の${describeDeadline(s.leadDays, s.cutoffHour)}）。`);
  }
  if (input.nights > s.maxNights) throw new PartnerStoreError(`1回のご予約は ${s.maxNights} 泊までです。`);
  if (input.rooms.length > s.maxRooms) throw new PartnerStoreError(`1回のご予約は ${s.maxRooms} 室までです。`);

  const g = input.guest;
  if (!g.familyName.trim()) throw new PartnerStoreError('ご宿泊者（代表者）の姓を入力してください。');
  if (!PHONE_RE.test(g.phone.trim())) throw new PartnerStoreError('電話番号を正しく入力してください。');
  if (g.email.trim() && !EMAIL_RE.test(g.email.trim())) throw new PartnerStoreError('メールアドレスの形式が正しくありません。');
  // 予約時に聞く項目（プランの項目＋この取引先だけの項目）。予約画面と同じ規則で決め直して検証する
  const form = await partnerBookingForm(db, partner, input.planCode, input.planName);
  const answers = resolveQuestionAnswers(form.questions, input.answers, input.rooms.length);
  // 部屋ごとの男女の内訳（必須・合計＝その部屋の大人の人数）。PMS へは電文の rooms[].male / female で渡る
  const genders = form.askGender ? resolveRoomGenders(input.rooms.map((r) => r.adults), (k) => input.genders?.[k]) : null;
  if (genders && !genders.ok) throw new PartnerStoreError(genders.message);
  if (!answers.ok) throw new PartnerStoreError(answers.message);
  const booker = normalizeBooker(input.booker);
  const bookerProblem = validateBooker(booker);
  if (bookerProblem) throw new PartnerStoreError(bookerProblem);
  const transport = resolveTransport(input.transport?.id ?? '', input.transport?.other ?? '');
  if (!transport.ok) throw new PartnerStoreError(transport.message);
  // JR のときのお迎え時間（西和賀＝乗合タクシー・男鹿＝迎えの車）。施設が選択肢を設定しているときだけ必須
  const pickup = (await loadStandardFieldTexts(partner.facility_id)).pickup;
  let pickupRow: { label: string; value: string } | null = null;
  if (input.transport?.id === 'jr' && pickup.choices.length) {
    const t = String(input.pickupTime ?? '').trim();
    if (!t) throw new PartnerStoreError(`「${pickup.label}」を選んでください。`);
    if (!pickup.choices.includes(t)) throw new PartnerStoreError(`「${pickup.label}」の選択肢が正しくありません。`);
    pickupRow = { label: pickup.label, value: t };
  }

  const quote = await quotePartnerBooking(db, partner, input);
  if (!quote.ok) throw new PartnerStoreError(quote.message);
  // 予約時決済の割引。予約金額（1泊ごとの料金・PMS の予約総額・キャンセル料の基準）は割引前のまま、
  // 割引額を台帳（prepay_discount_amount）に持ち、請求額から引く。PMS には支払明細「予約時決済割引」で入る（2026-09-26 指示）。
  const discount = paymentOption === 'online' && quote.prepay ? quote.prepay : null;
  const rooms = quote.rooms;
  // 予約者・交通手段・取引先特典は PMS の「事前質問・要望」（と備考）の先頭に載せる（宿が当日まで目にする場所）
  const extras = buildBookingExtras(booker, transport.value, perksForPlan(s.perks, quote.planCode));
  const genderRooms = genders?.ok ? genders.rooms : null;
  const genderRows = (genderRooms ?? []).map((gr, i) => ({ label: rooms.length > 1 ? `${i + 1}室目 男女の内訳` : '男女の内訳', value: genderText(gr) }));
  const optionValues = [...extraOptionRows(extras), ...(pickupRow ? [pickupRow] : []), ...genderRows, ...answers.values];

  const { data, error } = await db.rpc('rms_partner_create_booking', {
    p: {
      partner_id: partner.id,
      // 予約する施設（予約画面の施設・2026-10-09 複数施設化）。DB 関数が rms_partner_facilities のオン・受付・支払方法・設定で受ける
      facility_id: partner.facility_id,
      account_id: account.id,
      booked_by: account.login_id,
      room_code: quote.roomCode,
      room_name: quote.roomName,
      plan_code: quote.planCode,
      plan_name: quote.planName,
      meal_type: quote.mealType,
      check_in: quote.checkIn,
      check_out: quote.checkOut,
      rooms: rooms.map((r, i) => ({ adults: r.adults, nights: r.nights, ...(genderRooms?.[i] ?? {}) })),
      guest: {
        family_name: g.familyName.trim().slice(0, 40),
        given_name: g.givenName.trim().slice(0, 40),
        family_name_kana: g.familyNameKana.trim().slice(0, 40),
        given_name_kana: g.givenNameKana.trim().slice(0, 40),
        phone: g.phone.trim(),
        email: g.email.trim(),
        zip_code: g.zipCode.trim().slice(0, 10),
        address: g.address.trim().slice(0, 200),
        allergies: g.allergies.trim().slice(0, 500)
      },
      arrival: input.arrival.trim().slice(0, 20),
      options: optionValues,
      notes: input.notes.trim().slice(0, 1000),
      payment_option: paymentOption,
      payment_label: paymentOptionLabel(paymentOption, s),
      // 入湯税（円・宿泊全体）。台帳の作成と同時に入れ、PMS への電文（月末締め等は作成時に積む）に載せる（autumn-shared 20260926103712）
      bath_tax: quote.bathTax,
      // 予約時決済の割引額（円）。予約金額からは引かない（autumn-shared 20260926113433）
      prepay_discount: discount?.discount ?? 0,
      // オンライン決済は支払待ちの仮押さえで作り、支払完了（予約時決済）・カード登録完了（チェックアウト日決済）で
      // 確定・PMS へ（DB 関数 rms_partner_mark_paid / rms_partner_mark_card_saved）
      await_payment: isStripePaymentOption(paymentOption),
      // 添付ファイル（2026-10-07・autumn-shared 20261007022950）: 仮置きを電文の前に予約へ結ぶ。機能が off なら渡さない
      ...(input.attachmentIds?.length && partnerBookingAttachmentsEnabled() ? { attachment_ids: input.attachmentIds } : {})
    }
  });
  if (error) throw new PartnerStoreError(friendlyRpcError(error.message), 409);
  const created = data as { id: string; booking_code: string; total_amount: number; status?: string };
  // 台帳に予約者・交通手段・特典を構造化して残す（メールの宛先・一覧の表示に使う）。仮押さえ（オンライン決済）も同じ
  await attachBookingExtras(db, partner.id, created.id, extras, partnerPlanName(s.planNames, quote.planCode, quote.planName));
  // 予約時点のキャンセル規定を台帳に残す（取消時のキャンセル料はこれで計算する）。失敗しても予約は止めない
  // 予約時決済（全額・デポジット）は、予約前に見せた事務手数料の率も一緒に残す（2026-10-07）
  await snapshotCancelPolicy(db, partner.facility_id, created.id, quote.planCode, quote.planName, {
    adminFee: paymentOption === 'online' || isDepositPaymentOption(paymentOption)
  }).catch(() => undefined);
  if (input.saveBooker) {
    // マイページへの保存に失敗しても予約は止めない
    await saveBookerProfile(db, partner.id, account.id, booker).catch(() => undefined);
  }

  if (created.status === 'pending_payment') {
    const pending = await getPartnerBooking(db, partner.id, created.id);
    try {
      if (!pending) throw new Error('予約が見つかりません');
      const payment = await preparePartnerPayment(db, partner, pending);
      await logPartnerAccess(db, {
        partnerId: partner.id,
        accountId: account.id,
        channel: 'web',
        action: 'book_pending',
        detail: { bookingCode: created.booking_code, total: created.total_amount },
        ip: meta.ip
      });
      return { id: created.id, bookingCode: created.booking_code, total: created.total_amount, emailed: false, payment };
    } catch (e) {
      // 決済の準備ができなければ仮押さえを解放して、やり直してもらう
      await db.rpc('rms_partner_cancel_booking', { p_partner_booking_id: created.id, p_by: 'partner', p_reason: '決済の準備ができませんでした' });
      throw new PartnerStoreError(`オンライン決済を開始できませんでした。時間をおいてお試しください。${e instanceof Error ? `（${e.message}）` : ''}`, 502);
    }
  }

  await logPartnerAccess(db, {
    partnerId: partner.id,
    accountId: account.id,
    channel: 'web',
    action: 'book',
    detail: { bookingCode: created.booking_code, checkIn: quote.checkIn, nights: quote.nights, rooms: quote.rooms.length, total: created.total_amount },
    ip: meta.ip
  });

  const booking = await getPartnerBooking(db, partner.id, created.id);
  let emailed = false;
  if (booking) {
    emailed = await sendBookingMails(db, partner, booking, 'new', meta.origin, account.id).catch(() => false);
  }
  return { id: created.id, bookingCode: created.booking_code, total: created.total_amount, emailed };
}

// ---------------------------------------------------------------------------
// オンライン決済（同じ画面で払う方式・Stripe Payment Element / Express Checkout Element）
// ---------------------------------------------------------------------------
//
// 流れ（v0.42.0〜。それまでは Stripe Checkout の別ページへ移動していた）:
//   ① 予約を仮押さえ（rms_partner_create_booking を await_payment=true で。pending_payment・35分）
//   ② この予約の PaymentIntent（予約時決済）/ SetupIntent（チェックアウト日決済）を用意して client_secret を返す
//   ③ ブラウザが stripe.confirmPayment / confirmSetup（3Dセキュアは Stripe のモーダル）
//   ④ ブラウザから確定の連絡（confirmPartnerIntent）＋ Webhook（payment_intent.succeeded / setup_intent.succeeded）の
//      どちらか早い方で予約を確定する。どちらも Intent を Stripe から取り直して確かめ、DB 関数の冪等性
//      （rms_partner_mark_paid / rms_partner_mark_card_saved の 'already'）で二重確定を防ぐ。
// 台帳の stripe_session_id 列には、旧方式では Checkout のセッション id（cs_）、新方式では Intent の id（pi_ / seti_）を入れる
// （列名は旧方式のまま。次にブラウザへ渡すとき使い回せるかの判断に使う）。

const REF_KEY = 'partner_booking_id';

const intentMetadata = (partner: PartnerContext, b: PartnerBookingRow, extra: Record<string, string> = {}) =>
  buildIntentMetadata({
    app: STRIPE_APP,
    purpose: STRIPE_PURPOSE_PARTNER_BOOKING,
    refs: { [REF_KEY]: b.id, booking_code: b.booking_code, partner_id: partner.id, facility: partner.facility_slug, ...extra }
  });

// ブラウザに渡す決済の準備（予約・金額・同意文つき）
export type PreparedPartnerPayment = PreparedIntent & {
  bookingId: string;
  bookingCode: string;
  // 仮押さえの期限（予約時の支払・カード登録）。カードの登録し直しは null
  expiresAt: string | null;
  // チェックアウト日決済: 入力欄の直下に出す同意文（確定時に同じ文面を台帳へ残す）
  consentText: string | null;
};

// 予約（仮押さえ・カード登録し直し）の Intent を用意する（まだ使える Intent があれば使い回す）。
async function preparePartnerPayment(db: SupabaseClient, viewer: PartnerContext, b: PartnerBookingRow): Promise<PreparedPartnerPayment> {
  // 施設名・Stripe の metadata は予約の施設（取引先ページで選んでいる施設とは限らない）
  const partner = await contextForBooking(db, viewer, b);
  const base = { bookingId: b.id, bookingCode: b.booking_code, expiresAt: b.status === 'pending_payment' ? b.payment_expires_at : null };
  // 保存カード（2026-10-07・docs/saved-cards.md §7.2）: 取引先共有の Customer があれば Intent に付ける（予約画面の「保存済み」から選べる）。
  // 読めない・まだ無いときは null（従来どおり）
  const shared = await resolvePartnerCustomer(db, partner, { create: false }).catch(() => null);
  if (b.payment_option === 'online_checkin') {
    // 予約ごとの Customer を作る（共有 Customer が無いとき・Stripe 側で Customer が消えていたとき）。
    // suffix: 消えた Customer の作り直しでは別の冪等キーにする（同じキーだと消えた Customer の id が返るため）
    const createBookingCustomer = async (suffix = '') => {
      const id = (
        await createCustomer({
          name: `${b.guest_name}（${partner.name}）`,
          // Stripe の領収・通知は予約者（ご担当者）へ。宿泊者のメールは使わない
          email: b.detail.booker?.email || partner.contact_email,
          metadata: { app: STRIPE_APP, purpose: STRIPE_PURPOSE_PARTNER_BOOKING, partner_booking_id: b.id, booking_code: b.booking_code, partner_id: partner.id },
          idempotencyKey: `rms-partner-customer-${b.id}${suffix}`
        })
      ).id;
      await db.from('rms_partner_bookings').update({ stripe_customer_id: id }).eq('id', b.id);
      return id;
    };
    let customer = b.stripe_customer_id;
    if (!customer) {
      // 共有 Customer があればそれを使う。無ければ従来どおり予約ごとに作る（既に予約の Customer がある予約はそのまま）
      if (shared) {
        customer = shared;
        await db.from('rms_partner_bookings').update({ stripe_customer_id: customer }).eq('id', b.id);
      } else customer = await createBookingCustomer();
    }
    const consentText = cardConsentText(partner.facility_name, b);
    const setup = (cus: string, keySuffix = '') =>
      prepareSetupIntent({
        existingId: b.stripe_session_id,
        customer: cus,
        description: `${partner.facility_name} ご宿泊（${b.booking_code}）${b.check_out_date} チェックアウト日に ${chargeAmountOf(b).toLocaleString('ja-JP')}円 を請求`,
        metadata: intentMetadata(partner, b, { consent_text: consentText }),
        refKey: REF_KEY,
        // 同時に2回押されても1本になるよう、前回の Intent（無ければ first）から作る
        idempotencyKey: `rms-partner-si-${b.id}-${b.stripe_session_id ?? 'first'}${keySuffix}`
      });
    let r: Awaited<ReturnType<typeof setup>>;
    try {
      r = await setup(customer);
    } catch (e) {
      // 台帳の Customer（共有・予約ごと）が Stripe 側で消えていた → 予約ごとの Customer を作り直して従来の経路で登録させる
      if (!isStripeResourceMissing(e)) throw e;
      console.warn('[partner-booking] Customer が Stripe に見つからないため、予約ごとの Customer で作り直します:', b.booking_code, customer);
      const missing = customer;
      customer = await createBookingCustomer(`-${missing}`);
      r = await setup(customer, `-${missing}`);
    }
    const { prepared, created } = r;
    if (created) await db.from('rms_partner_bookings').update({ stripe_session_id: prepared.intentId }).eq('id', b.id);
    return { ...prepared, ...base, consentText };
  }
  // デポジット（deposit_online）は台帳の deposit_amount（DB 関数が計算した額）だけを受ける。それ以外は請求額
  const { prepared, created } = await preparePaymentIntent({
    existingId: b.stripe_session_id,
    amount: intentAmountOf(b),
    description: `${partner.facility_name} ご宿泊${isDepositPaymentOption(b.payment_option) ? 'のデポジット' : ''}（${b.booking_code}）${b.check_in_date} から ${b.nights}泊・${b.room_name ?? ''} ${b.room_count}室・${b.guest_name} 様`,
    metadata: intentMetadata(partner, b),
    refKey: REF_KEY,
    idempotencyKey: `rms-partner-pi-${b.id}-${b.stripe_session_id ?? 'first'}`,
    customer: shared
  });
  if (created) await db.from('rms_partner_bookings').update({ stripe_session_id: prepared.intentId }).eq('id', b.id);
  return { ...prepared, ...base, consentText: null };
}

// カード登録画面に出す同意文（請求日・金額・内訳）。登録完了時に同じ文面を台帳に残す。
export function cardConsentText(facilityName: string, b: Pick<PartnerBookingRow, 'booking_code' | 'check_out_date' | 'total_amount' | 'bath_tax_amount'>): string {
  const [y, m, d] = b.check_out_date.split('-').map(Number);
  const bath = b.bath_tax_amount ?? 0;
  return (
    `${facilityName}のご宿泊（予約番号 ${b.booking_code}）について、チェックアウト日の ${y}年${m}月${d}日に、` +
    `このカードへ ${yen(chargeAmountOf(b))}（宿泊料金 ${yen(b.total_amount)}${bath > 0 ? `・入湯税 ${yen(bath)}` : ''}）を請求することに同意します。` +
    'キャンセル料がかかる日に取り消した場合は、キャンセル料をこのカードへ請求します。'
  );
}

// チェックアウト日決済で、カードを登録し直せる状態か（請求前・請求失敗）。
export const canUpdateCard = (b: Pick<PartnerBookingRow, 'status' | 'payment_option' | 'payment_status'>) =>
  b.status === 'confirmed' && b.payment_option === 'online_checkin' && (b.payment_status === 'scheduled' || b.payment_status === 'charge_failed');

// 取引先の予約一覧の「お支払いへ進む」「カードの登録へ進む」「カードを登録し直す」。
export async function resumePartnerPayment(db: SupabaseClient, partner: PartnerContext, bookingId: string): Promise<PreparedPartnerPayment> {
  const b = await getPartnerBooking(db, partner.id, bookingId);
  if (b && canUpdateCard(b)) return preparePartnerPayment(db, partner, b);
  if (!b || b.status !== 'pending_payment') throw new PartnerStoreError('お支払い待ちの予約ではありません。');
  if (!isStripePaymentOption(b.payment_option ?? '')) throw new PartnerStoreError('オンライン決済の予約ではありません。');
  // 期限ぎりぎりで支払われると、確定前に仮押さえが切れて返金になる。1分を切ったら受け付けない。
  if (b.payment_expires_at && new Date(b.payment_expires_at).getTime() <= Date.now() + 60_000) {
    throw new PartnerStoreError('お支払いの期限が過ぎたため、仮押さえを解除しました。もう一度ご予約ください。');
  }
  return preparePartnerPayment(db, partner, b);
}

// 予約画面で、支払前に仮押さえをやめる（入力に戻って内容を変えるとき）。支払待ちの予約だけ。
export async function releasePendingBooking(db: SupabaseClient, partner: PartnerContext, bookingId: string): Promise<boolean> {
  const b = await getPartnerBooking(db, partner.id, bookingId);
  if (!b || b.status !== 'pending_payment') return false;
  await db.rpc('rms_partner_cancel_booking', { p_partner_booking_id: b.id, p_by: 'partner', p_reason: '予約画面で入力に戻りました' });
  return true;
}

// 予約 id から取引先を引き、予約の施設で合成する（Webhook・cron・ブラウザからの決済の連絡）。
async function partnerForBooking(db: SupabaseClient, bookingId: string): Promise<{ partner: PartnerContext; booking: PartnerBookingRow } | null> {
  const { data } = await db.from('rms_partner_bookings').select('partner_id').eq('id', bookingId).maybeSingle();
  if (!data?.partner_id) return null;
  const booking = await getPartnerBooking(db, String(data.partner_id), bookingId);
  if (!booking) return null;
  const partner = await loadPartnerContextAt(db, String(data.partner_id), booking.facility_id).catch(() => null);
  return partner ? { partner, booking } : null;
}

export type PaymentResult = {
  status: 'paid' | 'already' | 'unpaid' | 'refunded_late' | 'unknown' | 'card_saved' | 'card_updated' | 'card_late' | 'card_expiry';
  bookingCode?: string;
  // カード登録し直し後、その場で請求した結果
  charge?: ChargeResult;
};

/**
 * 同じ画面で払う方式の確定（ブラウザからの連絡と Webhook の両方から呼ぶ。何度呼んでも同じ結果）。
 * Intent を Stripe から取り直し、自分の予約の・完了した Intent であることを確かめてから DB 関数で確定する。
 * expectPartnerId を渡すと（ブラウザからの連絡）、ログイン中の取引先の予約でなければ unknown を返す。
 */
export async function confirmPartnerIntent(db: SupabaseClient, intentId: string, origin: string, expectPartnerId?: string): Promise<PaymentResult> {
  const exp = { app: STRIPE_APP, purpose: STRIPE_PURPOSE_PARTNER_BOOKING, refKey: REF_KEY };
  if (isPaymentIntentId(intentId)) {
    const pi = await retrievePaymentIntent(intentId);
    const ctx = await contextForIntent(db, pi.metadata?.[REF_KEY], expectPartnerId);
    if (!ctx) return { status: 'unknown' };
    // デポジットはデポジットの額（台帳の deposit_amount）、それ以外は請求額で確かめる
    const check = checkPaymentIntent(pi, { ...exp, refId: ctx.booking.id, expectedAmount: intentAmountOf(ctx.booking) });
    if (!check.ok && check.reason !== 'amount_mismatch') {
      return check.reason === 'not_succeeded' ? { status: 'unpaid', bookingCode: ctx.booking.booking_code } : { status: 'unknown' };
    }
    if (!check.ok) {
      // 作った Intent の金額は台帳の請求額そのものなので本来起きない。お金は受け取っているので、受け取った額で記録する。
      console.error('[partner-booking] 支払額が請求額と違います:', ctx.booking.booking_code, check.expected, check.actual);
    }
    return recordPaid(db, ctx, { sessionId: null, paymentIntent: pi.id, amount: pi.amount_received ?? pi.amount }, origin);
  }
  if (isSetupIntentId(intentId)) {
    const si = await retrieveSetupIntent(intentId, true);
    const ctx = await contextForIntent(db, si.metadata?.[REF_KEY], expectPartnerId);
    if (!ctx) return { status: 'unknown' };
    // Customer は台帳に書いたもの（取引先共有・予約ごと）と一致すること（保存カード・2026-10-07）
    const check = checkSetupIntent(si, { ...exp, refId: ctx.booking.id, customer: ctx.booking.stripe_customer_id ?? undefined });
    if (!check.ok) return check.reason === 'not_succeeded' ? { status: 'unpaid', bookingCode: ctx.booking.booking_code } : { status: 'unknown' };
    const pm = si.payment_method && typeof si.payment_method === 'object' ? si.payment_method : null;
    // 有効期限が請求日（チェックアウト日）より前に切れるカードは登録しない（予約は支払待ちのまま・別のカードを登録してもらう）
    if (cardExpiresBefore(pm?.card, ctx.booking.check_out_date)) return { status: 'card_expiry', bookingCode: ctx.booking.booking_code };
    return recordCardSaved(db, ctx, { sessionId: si.id, customer: idOf(si.customer)!, paymentMethod: idOf(si.payment_method)!, card: pm }, origin);
  }
  return { status: 'unknown' };
}

async function contextForIntent(db: SupabaseClient, bookingId: string | undefined, expectPartnerId?: string) {
  if (!bookingId) return null;
  const ctx = await partnerForBooking(db, bookingId);
  if (!ctx || (expectPartnerId && ctx.partner.id !== expectPartnerId)) return null;
  return ctx;
}

// 旧方式（Stripe Checkout）の決済画面の完了（Webhook checkout.session.completed）。v0.42.0 の切替前に開いた画面のためだけに残す。
export async function confirmCheckoutSession(db: SupabaseClient, sessionId: string, origin: string): Promise<PaymentResult> {
  const session = await retrieveCheckoutSession(sessionId, true);
  const bookingId = session.metadata?.[REF_KEY];
  if (!bookingId) return { status: 'unknown' };
  const ctx = await partnerForBooking(db, bookingId);
  if (!ctx) return { status: 'unknown' };
  const code = ctx.booking.booking_code;
  if (session.mode === 'setup') {
    const si = session.setup_intent && typeof session.setup_intent === 'object' ? session.setup_intent : null;
    if (session.status !== 'complete' || !si || si.status !== 'succeeded') return { status: 'unpaid', bookingCode: code };
    const pm = si.payment_method && typeof si.payment_method === 'object' ? si.payment_method : null;
    const pmId = pm?.id ?? (typeof si.payment_method === 'string' ? si.payment_method : null);
    if (!pmId || !session.customer) return { status: 'unpaid', bookingCode: code };
    if (cardExpiresBefore(pm?.card, ctx.booking.check_out_date)) return { status: 'card_expiry', bookingCode: code };
    return recordCardSaved(db, ctx, { sessionId: session.id, customer: session.customer, paymentMethod: pmId, card: pm }, origin);
  }
  if (session.payment_status !== 'paid') return { status: 'unpaid', bookingCode: code };
  return recordPaid(db, ctx, { sessionId: session.id, paymentIntent: session.payment_intent, amount: session.amount_total ?? intentAmountOf(ctx.booking) }, origin);
}

type BookingCtx = { partner: PartnerContext; booking: PartnerBookingRow };

// 予約時決済の支払完了を記録して予約を確定する（DB 関数が冪等: 2回目以降は 'already'）。
async function recordPaid(
  db: SupabaseClient,
  ctx: BookingCtx,
  p: { sessionId: string | null; paymentIntent: string | null; amount: number },
  origin: string
): Promise<PaymentResult> {
  const bookingId = ctx.booking.id;
  const { data, error } = await db.rpc('rms_partner_mark_paid', {
    p_partner_booking_id: bookingId,
    p_session_id: p.sessionId,
    p_payment_intent: p.paymentIntent,
    p_amount: p.amount
  });
  if (error) throw new PartnerStoreError(`支払の記録に失敗しました（${error.message}）`, 500);
  const result = String(data);
  const after = (await getPartnerBooking(db, ctx.partner.id, bookingId)) ?? ctx.booking;
  if (result === 'paid') {
    await logPartnerAccess(db, { partnerId: ctx.partner.id, accountId: after.account_id, channel: 'web', action: 'paid', detail: { bookingCode: after.booking_code, amount: p.amount } });
    await sendBookingMails(db, ctx.partner, after, 'new', origin, after.account_id).catch(() => false);
    return { status: 'paid', bookingCode: after.booking_code };
  }
  if (result === 'not_pending') {
    // 仮押さえの期限切れ・取消の後に支払が完了した → 部屋は押さえていないので全額返金する
    await refundBooking(db, after, 'late_payment');
    return { status: 'refunded_late', bookingCode: after.booking_code };
  }
  return { status: 'already', bookingCode: after.booking_code };
}

// チェックアウト日決済: カード登録の完了を記録して予約を確定する（何度呼んでも同じ結果）。
async function recordCardSaved(
  db: SupabaseClient,
  ctx: BookingCtx,
  p: { sessionId: string; customer: string; paymentMethod: string; card: StripePaymentMethod | null },
  origin: string
): Promise<PaymentResult> {
  const before = ctx.booking;
  const code = before.booking_code;
  const { data, error } = await db.rpc('rms_partner_mark_card_saved', {
    p_partner_booking_id: before.id,
    p_session_id: p.sessionId,
    p_customer: p.customer,
    p_payment_method: p.paymentMethod,
    p_card_label: cardLabelOf(p.card)
  });
  if (error) throw new PartnerStoreError(`カード登録の記録に失敗しました（${error.message}）`, 500);
  const result = String(data);
  if (result === 'saved' || result === 'updated') {
    // 同意の記録（カード入力欄の直下に出した文面と、登録を完了した日時）
    await db
      .from('rms_partner_bookings')
      .update({ card_consent_text: cardConsentText(ctx.partner.facility_name, before), card_consent_at: new Date().toISOString() })
      .eq('id', before.id);
  }
  const after = (await getPartnerBooking(db, ctx.partner.id, before.id)) ?? before;
  if (result === 'saved') {
    await logPartnerAccess(db, { partnerId: ctx.partner.id, accountId: after.account_id, channel: 'web', action: 'card_saved', detail: { bookingCode: code } });
    await sendBookingMails(db, ctx.partner, after, 'new', origin, after.account_id).catch(() => false);
    return { status: 'card_saved', bookingCode: code };
  }
  if (result === 'updated') {
    // 請求に失敗していた予約は、チェックアウト日を迎えていればその場で請求し直す
    const charge =
      before.payment_status === 'charge_failed' && after.check_out_date <= todayJst()
        ? await chargeBooking(db, ctx.partner, after, origin, 'card_updated')
        : undefined;
    return { status: 'card_updated', bookingCode: code, charge };
  }
  if (result === 'not_pending') return { status: 'card_late', bookingCode: code };
  return { status: 'already', bookingCode: code };
}

export type ChargeResult = { status: 'paid' | 'failed' | 'skipped'; message?: string };

// 管理画面（管理画面の施設で合成）・取引先ページ（選んでいる施設で合成）・cron（予約の施設で合成）のどれから来てもよい。
// 中で予約の施設に合成し直す（contextForBooking）
type AnyPartner = PartnerContext | PartnerRow;

/**
 * チェックアウト日決済（payment_option は online_checkin のまま）: 登録カードに請求する（定期処理・スタッフの再請求・カード登録し直しから）。
 * 同じ予約を同時に2回請求しないよう、charge_attempts を条件付きで進めてから Stripe を呼ぶ
 * （Stripe の冪等キーも試行回数ごと）。成功 → rms_partner_mark_charged（PMS へ paid 電文）。
 * 失敗 → payment_status='charge_failed' にして宿・取引先へメール。
 */
export async function chargeBooking(
  db: SupabaseClient,
  viewer: AnyPartner,
  b: PartnerBookingRow,
  origin: string,
  trigger: 'cron' | 'staff' | 'card_updated'
): Promise<ChargeResult> {
  const partner = await contextForBooking(db, viewer, b);
  if (b.status !== 'confirmed' || b.payment_option !== 'online_checkin') return { status: 'skipped', message: 'チェックアウト日決済の予約ではありません。' };
  if (b.payment_status !== 'scheduled' && b.payment_status !== 'charge_failed') return { status: 'skipped', message: '請求できる状態ではありません。' };
  if (!b.stripe_customer_id || !b.stripe_payment_method_id) return { status: 'skipped', message: 'カードが登録されていません。' };
  const attempt = (b.charge_attempts ?? 0) + 1;
  const { data: claimed } = await db
    .from('rms_partner_bookings')
    .update({ charge_attempts: attempt, last_charge_at: new Date().toISOString() })
    .eq('id', b.id)
    .eq('charge_attempts', b.charge_attempts ?? 0)
    .in('payment_status', ['scheduled', 'charge_failed'])
    .select('id');
  if (!claimed?.length) return { status: 'skipped', message: '別の処理が請求中です。' };

  const facilityName = partner.facility_name;
  let failure: string | null = null;
  let paymentIntent: string | null = null;
  try {
    const pi = await chargeSavedCard({
      customer: b.stripe_customer_id,
      paymentMethod: b.stripe_payment_method_id,
      amount: chargeAmountOf(b),
      description: `${facilityName} ご宿泊（${b.booking_code}）`,
      metadata: {
        app: STRIPE_APP,
        purpose: STRIPE_PURPOSE_PARTNER_BOOKING,
        partner_booking_id: b.id,
        booking_code: b.booking_code,
        partner_id: partner.id,
        trigger
      },
      idempotencyKey: `rms-partner-charge-${b.id}-${attempt}`
    });
    paymentIntent = pi.id;
    if (pi.status !== 'succeeded') failure = `請求が完了しませんでした（${pi.status}）`;
  } catch (e) {
    failure = friendlyChargeError(e);
  }

  if (failure) {
    await db.from('rms_partner_bookings').update({ payment_status: 'charge_failed', charge_error: failure.slice(0, 500) }).eq('id', b.id);
    await logPartnerAccess(db, { partnerId: partner.id, accountId: null, channel: 'web', action: 'charge_failed', detail: { bookingCode: b.booking_code, trigger, error: failure } });
    const after = (await getPartnerBooking(db, partner.id, b.id)) ?? b;
    await sendChargeFailedMails(db, partner, after, origin, failure).catch(() => false);
    return { status: 'failed', message: failure };
  }

  const { data, error } = await db.rpc('rms_partner_mark_charged', { p_partner_booking_id: b.id, p_payment_intent: paymentIntent, p_amount: chargeAmountOf(b) });
  if (error) {
    // 請求そのものは成功している。記録だけは残す（PMS の入金行は人が入れる）。
    console.error('[partner-booking] 請求の記録に失敗:', error.message);
    await db
      .from('rms_partner_bookings')
      .update({ payment_status: 'paid', paid_at: new Date().toISOString(), paid_amount: chargeAmountOf(b), stripe_payment_intent_id: paymentIntent })
      .eq('id', b.id);
  } else if (String(data) === 'not_active') {
    // 請求中に取り消された → 返金する
    const after = (await getPartnerBooking(db, partner.id, b.id)) ?? b;
    await refundBooking(db, after, 'charged_after_cancel');
  }
  await logPartnerAccess(db, { partnerId: partner.id, accountId: null, channel: 'web', action: 'charged', detail: { bookingCode: b.booking_code, trigger, amount: chargeAmountOf(b) } });
  return { status: 'paid' };
}

function friendlyChargeError(e: unknown): string {
  if (!(e instanceof StripeError)) return e instanceof Error ? e.message : String(e);
  const reasons: Record<string, string> = {
    authentication_required: 'カード会社の本人認証が必要なため、自動で請求できませんでした',
    insufficient_funds: 'カードの利用可能額が不足しています',
    expired_card: 'カードの有効期限が切れています',
    card_declined: 'カードが利用できませんでした（カード会社が承認しませんでした）',
    do_not_honor: 'カードが利用できませんでした（カード会社が承認しませんでした）',
    generic_decline: 'カードが利用できませんでした（カード会社が承認しませんでした）',
    lost_card: 'カードが利用できませんでした',
    stolen_card: 'カードが利用できませんでした',
    processing_error: 'カード会社との通信でエラーが起きました（時間をおいて再請求してください）'
  };
  return (e.code && reasons[e.code]) || e.message;
}

// スタッフの「再請求」（Book の管理画面 /admin/partners/[id]）。
export async function retryPartnerCharge(db: SupabaseClient, partner: AnyPartner, bookingId: string, origin: string): Promise<ChargeResult> {
  const b = await getPartnerBooking(db, partner.id, bookingId);
  if (!b) throw new PartnerStoreError('予約が見つかりません。', 404);
  return chargeBooking(db, partner, b, origin, 'staff');
}

// 定期処理（毎時）: チェックアウト日を迎えた「チェックアウト日決済」の予約に請求する（2026-10-07 にチェックイン日から変更・
// 現地の精算と揃える）。請求失敗の予約は自動では再請求しない。
export async function chargeDueBookings(db: SupabaseClient, origin: string): Promise<{ target: number; paid: number; failed: number; skipped: number }> {
  const { data } = await db
    .from('rms_partner_bookings')
    .select('id')
    .eq('status', 'confirmed')
    .eq('payment_option', 'online_checkin')
    .eq('payment_status', 'scheduled')
    .lte('check_out_date', todayJst())
    .order('check_out_date')
    .limit(50);
  const rows = (data ?? []) as { id: string }[];
  const out = { target: rows.length, paid: 0, failed: 0, skipped: 0 };
  for (const r of rows) {
    const ctx = await partnerForBooking(db, r.id);
    if (!ctx) {
      out.skipped += 1;
      continue;
    }
    const res = await chargeBooking(db, ctx.partner, ctx.booking, origin, 'cron').catch((e) => ({ status: 'failed' as const, message: String(e) }));
    out[res.status === 'paid' ? 'paid' : res.status === 'failed' ? 'failed' : 'skipped'] += 1;
  }
  return out;
}

// 支払済みの予約を返金して台帳に結果を残す。amount を省くと全額（キャンセル料を差し引くときは返金額を渡す）。
async function refundBooking(db: SupabaseClient, b: PartnerBookingRow, reason: string, amount?: number): Promise<boolean> {
  const { data } = await db.from('rms_partner_bookings').select('stripe_payment_intent_id, payment_status').eq('id', b.id).maybeSingle();
  const intent = data?.stripe_payment_intent_id as string | null | undefined;
  if (!intent || data?.payment_status === 'refunded') return false;
  let refundId: string;
  try {
    refundId = (await createRefund(intent, `rms-partner-refund-${b.id}`, { partner_booking_id: b.id, booking_code: b.booking_code, reason }, amount)).id;
  } catch (e) {
    await db
      .from('rms_partner_bookings')
      .update({ payment_status: 'refund_failed', refund_error: e instanceof Error ? e.message.slice(0, 500) : String(e) })
      .eq('id', b.id);
    return false;
  }
  // 返金の記録と、PMS に送った予約なら返金電文（PMS が請求書にマイナスの入金行を起こす）。
  const { error } = await db.rpc('rms_partner_mark_refunded', { p_partner_booking_id: b.id, p_refund_id: refundId, p_amount: amount ?? null });
  if (error) {
    // 返金そのものは成功している。記録だけは残す（PMS の請求書は人が直す）。
    console.error('[partner-booking] 返金の記録に失敗:', error.message);
    await db
      .from('rms_partner_bookings')
      .update({ payment_status: 'refunded', stripe_refund_id: refundId, refund_error: null, ...(amount != null ? { refund_amount: amount } : {}) })
      .eq('id', b.id);
  }
  return true;
}

/**
 * Stripe の管理画面など RMS の外で返金されたとき（Webhook charge.refunded）。
 * 全額返金になった取引先予約だけを「返金済み」にし、PMS へ返金電文を積む。一部返金は人が扱う（記録しない）。
 * RMS 自身の返金（refundBooking）でも同じイベントが来るが、rms_partner_mark_refunded が 'already' を返すだけ。
 */
export async function syncRefundFromStripe(
  db: SupabaseClient,
  charge: { payment_intent?: unknown; refunded?: unknown; amount?: unknown; amount_refunded?: unknown }
): Promise<'refunded' | 'already' | 'partial' | 'not_ours'> {
  const intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  if (!intent) return 'not_ours';
  const { data } = await db.from('rms_partner_bookings').select('id, payment_status').eq('stripe_payment_intent_id', intent).maybeSingle();
  if (!data) return 'not_ours';
  if (data.payment_status === 'refunded') return 'already';
  if (charge.refunded !== true) return 'partial';
  const refunds = await listRefunds(intent).catch(() => null);
  const refundId = refunds?.data.find((r) => r.status === 'succeeded')?.id ?? refunds?.data[0]?.id ?? 'stripe_dashboard';
  const { data: res, error } = await db.rpc('rms_partner_mark_refunded', { p_partner_booking_id: data.id, p_refund_id: refundId });
  if (error) throw new PartnerStoreError(`返金の記録に失敗しました（${error.message}）`, 500);
  return String(res) === 'already' ? 'already' : 'refunded';
}

export const isStripeTestMode = stripeTestMode;
export { stripeKeyHint, stripeKeyKind } from '$lib/server/stripe';

// ---------------------------------------------------------------------------
// 一覧・取消
// ---------------------------------------------------------------------------

export type PartnerBookingRow = {
  id: string;
  /** 名義人の名称を引くときのテナントの絞り込み用 */
  tenant_id?: string;
  /** 予約の施設（予約は必ず1施設・複数施設化の後も台帳が正。メール・取消・請求はこの施設で合成する） */
  facility_id: string;
  partner_id: string | null;
  partner_name: string;
  account_id: string | null;
  booked_by: string | null;
  booking_code: string;
  status: 'pending_payment' | 'confirmed' | 'cancelled' | 'expired';
  stay_ids: string[];
  room_code: string | null;
  room_name: string | null;
  plan_code: string | null;
  plan_name: string | null;
  meal_type: string | null;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  room_count: number;
  adult_total: number;
  guest_name: string;
  guest_kana: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  // 宿泊料金（キャンセル料の基準）。オンライン決済の請求額は total_amount + bath_tax_amount（chargeAmountOf）
  total_amount: number;
  bath_tax_amount: number;
  // 予約時決済の割引額（円）。請求額＝total_amount＋bath_tax_amount−これ
  prepay_discount_amount: number;
  // デポジット（Phase 3b・autumn-shared 20261007002617）: payment_option='deposit_online' のときだけ。
  // deposit_amount = 予約時に受ける額（決済後は paid_amount と同じ）。remainder_option = 残額の精算（invoice_monthly / custom_* / onsite）
  deposit_amount?: number | null;
  remainder_option?: string | null;
  card_consent_text: string | null;
  card_consent_at: string | null;
  payment_method_name: string | null;
  payment_option: string | null;
  // none（後払い）/ unpaid（支払待ち）/ paid / refunded / refund_failed
  payment_status: string;
  payment_expires_at: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  stripe_session_id: string | null;
  refund_error: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  card_label: string | null;
  charge_attempts: number;
  charge_error: string | null;
  detail: {
    rooms?: { adults: number; nights: { date: string; unit_price: number }[] }[];
    guest?: Record<string, string>;
    arrival?: string | null;
    options?: { label: string; value: string }[];
    notes?: string | null;
    // 2026-10-01〜: 予約者（ご担当者）・交通手段・取引先特典（予約時点の内容）。それより前の予約には無い
    booker?: PartnerBooker | null;
    transport?: string | null;
    perks?: { title: string; description: string }[] | null;
    // 2026-10-03〜: 取引先向けのプラン名（予約時点）。無い予約は plan_name から既定の表示名を作る
    plan_display_name?: string | null;
  };
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
  cancel_reason?: string | null;
  // キャンセル料（autumn-shared 20261006022716）。基準は total_amount（割引前・入湯税を除く税込）
  cancel_policy?: unknown;
  cancel_fee?: number;
  cancel_fee_rate?: number | null;
  cancel_fee_basis?: string | null;
  cancel_fee_waived?: boolean;
  // invoice（月末の請求書）/ refund（予約時決済から差し引き）/ card（登録カードへ請求）/ none
  cancel_fee_settlement?: CancelSettlement | null;
  cancel_fee_status?: 'charged' | 'charge_failed' | null;
  cancel_fee_error?: string | null;
  cancel_fee_note?: string | null;
  refund_amount?: number | null;
  // PMS 側の状態（チェックイン済みなら取り消せない）
  checkedIn?: boolean;
  // 予約時の紐づけ先（PMS 顧客）と名義（autumn-shared 20261006224655 / 20261006230308）。
  // name_mode = 'partner' なら PMS の代表者は紐づけ先で、guest_name は部屋の宿泊者名。
  pms_guest_id?: string | null;
  name_mode?: BookingNameMode;
  // 名義が partner のときの名義人（予約時の紐づけ先の正式名称。読めなければ取引先名）。読み込み時に付ける
  name_holder?: string | null;
  // 予約時の受付枠（与信）の判定（autumn-shared 20261007000239・rms_partner_credit_check の返り値そのまま）。null = 判定なし
  credit_result?: unknown;
  // 添付ファイルの名前（2026-10-07）。台帳の列ではない: 予約確認メールを組み立てるときだけ sendBookingMails が付ける
  attachment_names?: string[];
};

// 予約1件の名義の行（「ご予約名義: 株式会社JTB（お部屋の宿泊者名: 山田 太郎 様）」）。名義が宿泊者名なら null
export const bookingNameLineOf = (b: Pick<PartnerBookingRow, 'name_mode' | 'name_holder' | 'guest_name' | 'partner_name'>) =>
  bookingNameLine(b.name_mode, b.name_holder, b.guest_name, b.partner_name);

const BOOKING_COLUMNS =
  'id, tenant_id, facility_id, partner_id, partner_name, account_id, booked_by, booking_code, status, stay_ids, room_code, room_name, plan_code, plan_name, meal_type, check_in_date, check_out_date, nights, room_count, adult_total, guest_name, guest_kana, guest_phone, guest_email, total_amount, bath_tax_amount, prepay_discount_amount, card_consent_text, card_consent_at, payment_method_name, payment_option, payment_status, payment_expires_at, paid_at, paid_amount, stripe_session_id, refund_error, stripe_customer_id, stripe_payment_method_id, card_label, charge_attempts, charge_error, detail, cancelled_at, cancelled_by, created_at, cancel_reason, cancel_policy, cancel_fee, cancel_fee_rate, cancel_fee_basis, cancel_fee_waived, cancel_fee_settlement, cancel_fee_status, cancel_fee_error, cancel_fee_note, refund_amount, pms_guest_id, name_mode, credit_result, deposit_amount, remainder_option';

async function attachStayState(db: SupabaseClient, rows: PartnerBookingRow[]): Promise<PartnerBookingRow[]> {
  rows = await attachNameHolder(db, rows);
  const ids = [...new Set(rows.flatMap((r) => r.stay_ids ?? []))];
  if (!ids.length) return rows;
  const { data } = await coreDb(db).from('stays').select('id, status').in('id', ids);
  const inHouse = new Set(
    ((data ?? []) as { id: string; status: string }[]).filter((s) => s.status === 'checked_in' || s.status === 'checked_out').map((s) => s.id)
  );
  return rows.map((r) => ({ ...r, checkedIn: (r.stay_ids ?? []).some((id) => inHouse.has(id)) }));
}

// 名義が partner の予約に名義人（予約時の紐づけ先の正式名称）を付ける。取引先の今の紐づけではなく予約のスナップショットから引く。
// 紐づけ先が読めない（統合・削除）ときは取引先名で代える（bookingNameLineOf の fallback）。
async function attachNameHolder(db: SupabaseClient, rows: PartnerBookingRow[]): Promise<PartnerBookingRow[]> {
  const normalized = rows.map((r) => ({ ...r, name_mode: normalizeBookingNameMode(r.name_mode) }));
  const targets = normalized.filter((r) => r.name_mode === 'partner');
  if (!targets.length) return normalized;
  // 同じテナントの顧客だけを引く（他テナントの名称が混ざる経路を構造的に塞ぐ）
  const names = await pmsGuestFormalNames(db, targets.map((r) => r.pms_guest_id), targets[0].tenant_id).catch(() => new Map<string, string>());
  return normalized.map((r) => (r.name_mode === 'partner' ? { ...r, name_holder: (r.pms_guest_id && names.get(r.pms_guest_id)) || null } : r));
}

export async function listPartnerBookings(
  db: SupabaseClient,
  filter: { partnerId?: string; facilityId?: string; limit?: number }
): Promise<PartnerBookingRow[]> {
  let q = db.from('rms_partner_bookings').select(BOOKING_COLUMNS).order('check_in_date', { ascending: false }).limit(filter.limit ?? 200);
  if (filter.partnerId) q = q.eq('partner_id', filter.partnerId);
  if (filter.facilityId) q = q.eq('facility_id', filter.facilityId);
  const { data, error } = await q;
  if (error) return [];
  return attachStayState(db, (data ?? []) as PartnerBookingRow[]);
}

export async function getPartnerBooking(db: SupabaseClient, partnerId: string, id: string): Promise<PartnerBookingRow | null> {
  const { data } = await db.from('rms_partner_bookings').select(BOOKING_COLUMNS).eq('id', id).eq('partner_id', partnerId).maybeSingle();
  if (!data) return null;
  const [row] = await attachStayState(db, [data as PartnerBookingRow]);
  return row;
}

// ---------------------------------------------------------------------------
// キャンセル料（2026-10-06 指示・計算は lib/partner-cancel-fee.ts）
// ---------------------------------------------------------------------------

// 今のプランの規定（プラン個別 → 施設の既定）。取引先ページのキャンセルポリシーと同じ元データ。
async function currentCancelPolicy(db: SupabaseClient, facilityId: string, planCode: string | null, planName: string | null): Promise<CancelPolicy | null> {
  const { data, error } = await db.rpc('rms_partner_plan_terms', { p_facility: facilityId });
  if (error) return null;
  return planCancelPolicy(data, planCode, planName);
}

// 予約時点の規定を台帳（cancel_policy）に残す。opts.adminFee のとき、事務手数料の率（admin_fee_percent）も同じ jsonb に残す
// （予約時決済の取消で返金しない率・2026-10-07。率の無い予約＝導入前・後払いの予約は事務手数料なし）。
// 規定の段が無いプランでも率だけは残す（readCancelPolicy は段も不泊も無ければ null を返すので、取消時は今の規定を読む）。
async function snapshotCancelPolicy(
  db: SupabaseClient,
  facilityId: string,
  bookingId: string,
  planCode: string | null,
  planName: string | null,
  opts: { adminFee?: boolean } = {}
) {
  const policy = await currentCancelPolicy(db, facilityId, planCode, planName);
  const adminFeePercent = opts.adminFee ? await loadCancelAdminFeePercent(facilityId) : null;
  if (!policy && adminFeePercent == null) return;
  const stored = { ...(policy ? storeCancelPolicy(policy) : { rules: [], no_show_rate_percent: null }), ...(adminFeePercent != null ? { admin_fee_percent: adminFeePercent } : {}) };
  await db.from('rms_partner_bookings').update({ cancel_policy: stored }).eq('id', bookingId);
}

// 予約の規定（予約時点に残したもの → 無い予約は今のプランの規定）
async function cancelPolicyOf(db: SupabaseClient, facilityId: string, b: PartnerBookingRow): Promise<CancelPolicy | null> {
  return readCancelPolicy(b.cancel_policy) ?? (await currentCancelPolicy(db, facilityId, b.plan_code, b.plan_name));
}

export type StaffFeeMode = 'rule' | 'no_show' | 'custom' | 'waive';

/** スタッフの取消フォーム（components/admin/PartnerCancelFeeFields）の値。adminFeeWaived = 事務手数料も免除（既定は差し引く） */
export function parseStaffFeeForm(fd: FormData): { feeMode: StaffFeeMode; customFee: number | null; feeNote: string; adminFeeWaived: boolean } {
  const m = String(fd.get('feeMode') ?? 'rule');
  const feeMode: StaffFeeMode = m === 'no_show' || m === 'custom' || m === 'waive' ? m : 'rule';
  const raw = String(fd.get('customFee') ?? '').trim();
  return { feeMode, customFee: raw === '' ? null : Number(raw), feeNote: String(fd.get('feeNote') ?? ''), adminFeeWaived: fd.get('adminFeeWaive') === 'on' };
}

export type CancelPreview = {
  base: number;
  daysBefore: number;
  rate: number;
  fee: number;
  basis: string;
  noShowRate: number;
  noShowFee: number;
  table: { label: string; rate: number; current: boolean }[];
  settlement: CancelSettlement;
  // 予約時決済（支払済み）・デポジットのとき: 支払額・差し引く額（充当額）・返金額（デポジットは不足分も）
  refund: PartnerRefund | null;
  // デポジット予約のとき: 残額を請求書で受けるか（表示用。取消の不足分は 2026-10-07 から精算先にかかわらず請求書）。デポジットでなければ null
  depositRemainderBilled: boolean | null;
  // 精算の一文（画面に出す）
  settlementText: string;
  // 事務手数料（2026-10-07）: 予約に残した率（無い予約は null）と、スタッフの取消フォームで返金額を計算し直すための値
  adminFeePercent: number | null;
  prepayDiscount: number;
  bathTax: number;
};

function previewFrom(b: PartnerBookingRow, policy: CancelPolicy | null, now = new Date()): CancelPreview {
  const q = quoteCancelFee(b, policy, { now });
  const ns = quoteCancelFee(b, policy, { now, noShow: true });
  const settlement = settlementOf(b, q.fee);
  const refund = settlement === 'refund' || settlement === 'deposit' ? partnerRefundOf(b, q.fee) : null;
  return {
    ...q,
    noShowRate: ns.rate,
    noShowFee: ns.fee,
    table: cancelPolicyTable(policy, q.daysBefore),
    settlement,
    refund,
    depositRemainderBilled: isDepositPaymentOption(b.payment_option) ? isDepositRemainderBilled(b.remainder_option) : null,
    settlementText: settlementText(settlement, q.fee, invoiceMonthLabel(b.check_out_date), refund),
    adminFeePercent: refund ? readAdminFeeTerms(b.cancel_policy).percent : null,
    prepayDiscount: Math.max(0, b.prepay_discount_amount ?? 0),
    bathTax: Math.max(0, b.bath_tax_amount ?? 0)
  };
}

/** 取消確認欄に出すキャンセル料の見込み（確定済みの予約だけ。それ以外は null）。 */
export async function previewPartnerCancel(db: SupabaseClient, facilityId: string, b: PartnerBookingRow, now = new Date()): Promise<CancelPreview | null> {
  if (b.status !== 'confirmed') return null;
  // 今の規定は予約の施設のもの（facilityId は台帳に施設が無いときの代わり）
  return previewFrom(b, await cancelPolicyOf(db, b.facility_id || facilityId, b), now);
}

/** 一覧の確定済み予約の見込みをまとめて（今の規定の読み込みは施設ごとに1回）。facilityId は台帳に施設が無い行の代わり */
export async function previewPartnerCancels(
  db: SupabaseClient,
  facilityId: string,
  rows: PartnerBookingRow[],
  now = new Date()
): Promise<Record<string, CancelPreview>> {
  const targets = rows.filter((r) => r.status === 'confirmed' && !r.checkedIn);
  if (!targets.length) return {};
  const facOf = (r: PartnerBookingRow) => r.facility_id || facilityId;
  // 予約時点の規定が無い予約の施設だけ、今の規定を読む（予約は施設ごとに規定が違う）
  const needFacilities = [...new Set(targets.filter((r) => !readCancelPolicy(r.cancel_policy)).map(facOf))];
  const termsBy = new Map<string, unknown>();
  await Promise.all(
    needFacilities.map(async (fac) => {
      const terms = await db.rpc('rms_partner_plan_terms', { p_facility: fac }).then(
        (r) => (r.error ? null : r.data),
        () => null
      );
      termsBy.set(fac, terms);
    })
  );
  const out: Record<string, CancelPreview> = {};
  for (const r of targets) {
    const terms = termsBy.get(facOf(r));
    out[r.id] = previewFrom(r, readCancelPolicy(r.cancel_policy) ?? (terms ? planCancelPolicy(terms, r.plan_code, r.plan_name) : null), now);
  }
  return out;
}

// キャンセル料を登録カードへ請求（チェックアウト日決済の予約）。失敗したら月末の請求書へ回す。
async function chargeCancelFee(db: SupabaseClient, partner: PartnerContext, b: PartnerBookingRow, fee: number): Promise<{ ok: boolean; message?: string }> {
  const fail = async (message: string) => {
    await db
      .from('rms_partner_bookings')
      .update({ cancel_fee_settlement: 'invoice', cancel_fee_status: 'charge_failed', cancel_fee_error: message.slice(0, 500) })
      .eq('id', b.id);
    return { ok: false, message };
  };
  if (!b.stripe_customer_id || !b.stripe_payment_method_id) return fail('カードが登録されていません');
  const facilityName = partner.facility_name;
  try {
    const pi = await chargeSavedCard({
      customer: b.stripe_customer_id,
      paymentMethod: b.stripe_payment_method_id,
      amount: fee,
      description: `${facilityName} キャンセル料（${b.booking_code}）`,
      metadata: {
        app: STRIPE_APP,
        purpose: STRIPE_PURPOSE_PARTNER_BOOKING,
        partner_booking_id: b.id,
        booking_code: b.booking_code,
        partner_id: partner.id,
        trigger: 'cancel_fee'
      },
      idempotencyKey: `rms-partner-cancel-fee-${b.id}`
    });
    if (pi.status !== 'succeeded') return fail(`請求が完了しませんでした（${pi.status}）`);
    await db.from('rms_partner_bookings').update({ cancel_fee_status: 'charged', cancel_fee_payment_intent: pi.id, cancel_fee_error: null }).eq('id', b.id);
    return { ok: true };
  } catch (e) {
    return fail(friendlyChargeError(e));
  }
}

export async function cancelPartnerBooking(
  db: SupabaseClient,
  viewer: AnyPartner,
  bookingId: string,
  by: 'partner' | 'staff',
  opts: {
    reason?: string;
    accountId?: string | null;
    ip?: string | null;
    origin: string;
    refund?: boolean;
    // 取引先: 確認欄で見せたキャンセル料（日をまたいで変わっていたら取り消さずに見直してもらう）
    expectedFee?: number | null;
    // スタッフ: 規定どおり / 不泊 / 金額を変える / 免除
    feeMode?: StaffFeeMode;
    customFee?: number | null;
    feeNote?: string;
    // スタッフ: 事務手数料も免除する（既定は差し引く。キャンセル料の免除とは別に選ぶ・2026-10-07）
    adminFeeWaived?: boolean;
  }
): Promise<PartnerBookingRow> {
  const booking = await getPartnerBooking(db, viewer.id, bookingId);
  if (!booking) throw new PartnerStoreError('予約が見つかりません。', 404);
  if (booking.status === 'cancelled' || booking.status === 'expired') return booking;
  // 取消の期限・キャンセル規定・メールは予約の施設の設定で（N6: 施設ごとの cancelDays）
  const partner = await contextForBooking(db, viewer, booking);
  // 支払待ち（仮押さえ）の取消はいつでもできる。PMS へは何も送っていない。キャンセル料もかからない。
  if (booking.status === 'pending_payment') {
    await db.rpc('rms_partner_cancel_booking', { p_partner_booking_id: booking.id, p_by: by, p_reason: (opts.reason ?? '').slice(0, 500) || null });
    return (await getPartnerBooking(db, partner.id, bookingId)) ?? booking;
  }
  if (booking.checkedIn) throw new PartnerStoreError('チェックイン済みの予約は取り消せません。宿へご連絡ください。');
  if (by === 'partner' && !canPartnerCancel(booking.check_in_date, partner.booking_settings)) {
    const s = partner.booking_settings;
    throw new PartnerStoreError(
      s.cancelDays == null
        ? 'この画面からは取り消せません。宿へご連絡ください。'
        : `取消の期限（宿泊日の${describeDeadline(s.cancelDays, s.cutoffHour)}）を過ぎています。宿へご連絡ください。`
    );
  }

  // キャンセル料（基準は割引前・入湯税を除く税込の予約金額）
  const policy = await cancelPolicyOf(db, partner.facility_id, booking);
  const rule = quoteCancelFee(booking, policy);
  const mode: StaffFeeMode = by === 'partner' ? 'rule' : (opts.feeMode ?? 'rule');
  let fee = rule.fee;
  let rate: number | null = rule.rate;
  let basis = rule.basis;
  if (mode === 'no_show') {
    const ns = quoteCancelFee(booking, policy, { noShow: true });
    fee = ns.fee;
    rate = ns.rate;
    basis = '不泊';
  } else if (mode === 'custom') {
    const n = Math.round(Number(opts.customFee));
    if (opts.customFee == null || !Number.isFinite(n) || n < 0) throw new PartnerStoreError('キャンセル料の金額を正しく入力してください。');
    fee = Math.min(n, booking.total_amount);
    rate = null;
    basis = '金額指定';
  } else if (mode === 'waive') {
    fee = 0;
    rate = null;
    basis = '免除';
  }
  if (by === 'partner' && opts.expectedFee != null && Math.round(opts.expectedFee) !== fee) {
    throw new PartnerStoreError(`キャンセル料が変わりました（${yen(fee)}）。内容をご確認のうえ、もう一度お取り消しください。`, 409);
  }
  const waived = mode === 'waive';
  const settlement = settlementOf(booking, fee);

  const { data: cancelled, error } = await db.rpc('rms_partner_cancel_booking', {
    p_partner_booking_id: booking.id,
    p_by: by,
    p_reason: (opts.reason ?? '').slice(0, 500) || null,
    p_fee: { fee, rate, basis, waived, settlement, note: (opts.feeNote ?? '').trim().slice(0, 500) || null }
  });
  if (error) {
    throw new PartnerStoreError(
      error.message.includes('already_checked_in') ? 'チェックイン済みの予約は取り消せません。' : '取り消しできませんでした。時間をおいてお試しください。',
      409
    );
  }
  await logPartnerAccess(db, {
    partnerId: partner.id,
    accountId: opts.accountId ?? null,
    channel: 'web',
    action: by === 'partner' ? 'cancel' : 'staff_cancel',
    detail: { bookingCode: booking.booking_code, cancelFee: fee, basis, settlement },
    ip: opts.ip ?? null
  });
  // 事務手数料の免除（スタッフが選んだときだけ）は、予約に残した規定（cancel_policy）に印を残す（取消後の表示・請求書が同じ計算になるように）
  const adminFeeWaived = by === 'staff' && opts.adminFeeWaived === true;
  if (adminFeeWaived && readAdminFeeTerms(booking.cancel_policy).percent != null) {
    const cp = booking.cancel_policy && typeof booking.cancel_policy === 'object' ? (booking.cancel_policy as Record<string, unknown>) : {};
    await db
      .from('rms_partner_bookings')
      .update({ cancel_policy: { ...cp, admin_fee_waived: true } })
      .eq('id', booking.id);
  }
  // 予約時決済（支払済み）: max(キャンセル料, 割引額, 事務手数料) を差し引いて返金。キャンセル料の免除は割引分も返す（事務手数料は別に選ぶ）。
  // スタッフの取消で「返金しない」を選んだときは Stripe に触らない（宿で扱う）
  const paid = (cancelled as { payment_status?: string } | null)?.payment_status === 'paid';
  if (paid && (by === 'partner' || opts.refund !== false)) {
    const r = partnerRefundOf(booking, fee, waived, adminFeeWaived);
    if (r.refund > 0) await refundBooking(db, booking, by === 'partner' ? 'partner_cancel' : 'staff_cancel', r.kept > 0 ? r.refund : undefined);
  }
  // チェックアウト日決済（カード登録のみ）: キャンセル料を登録カードへ。失敗したら月末の請求書へ回す
  if (settlement === 'card' && fee > 0) await chargeCancelFee(db, partner, booking, fee);
  const after = (await getPartnerBooking(db, partner.id, bookingId)) ?? booking;
  await sendBookingMails(db, partner, after, 'cancelled', opts.origin, booking.account_id).catch(() => false);
  return after;
}

// ---------------------------------------------------------------------------
// 通知メール
// ---------------------------------------------------------------------------

const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付き' : m === '朝食' ? '朝食付き' : m === '素泊' ? '素泊まり' : (m ?? ''));

// 取引先に見せるプラン名: 予約時点の取引先向けの名前 → 無ければ plan_name から既定の表示名
export const bookingPlanName = (b: { plan_name: string | null; detail?: { plan_display_name?: string | null } | null }) =>
  (b.detail?.plan_display_name ?? '').trim() || partnerPlanName(undefined, null, b.plan_name ?? '');

// audience: 取引先宛ては取引先向けのプラン名。宿宛ては元のプラン名（PMS と同じ）に取引先向けの名前を添える。
export function bookingSummaryLines(b: PartnerBookingRow, audience: 'partner' | 'facility' = 'partner'): string[] {
  const shown = bookingPlanName(b);
  const planLine =
    audience === 'facility' && b.plan_name && shown !== b.plan_name ? `${b.plan_name}（取引先向けの名前: ${shown}）` : shown;
  const g = b.detail.guest ?? {};
  const rooms = b.detail.rooms ?? [];
  const lines = [
    `予約番号: ${b.booking_code}`,
    `宿泊日: ${b.check_in_date}（${b.nights}泊）〜 ${b.check_out_date} チェックアウト`,
    `お部屋: ${b.room_name ?? b.room_code ?? ''} × ${b.room_count}室`,
    `プラン: ${planLine}${b.meal_type ? `（${mealLabel(b.meal_type)}）` : ''}`,
    `人数: ${rooms.map((r, i) => `${rooms.length > 1 ? `${i + 1}室目 ` : ''}${r.adults}名`).join(' / ') || `${b.adult_total}名`}`,
    // ご予約者（ご担当者）・交通手段・専用特典（detail に構造化して残したもの）
    ...extraSummaryLines(b.detail),
    // 旅行会社名義（Phase 2）: 名義人と部屋の宿泊者名。宿泊者名義の予約には出さない
    ...[bookingNameLineOf(b)].filter((l): l is string => !!l),
    `ご宿泊者: ${b.guest_name}${b.guest_kana ? `（${b.guest_kana}）` : ''}`,
    `電話: ${b.guest_phone ?? ''}`,
    ...(b.guest_email ? [`メール: ${b.guest_email}`] : []),
    ...(g.address || g.zip_code ? [`住所: ${[g.zip_code, g.address].filter(Boolean).join(' ')}`] : []),
    ...(g.allergies ? [`アレルギー: ${g.allergies}`] : []),
    ...(b.detail.arrival ? [`到着予定: ${b.detail.arrival}`] : []),
    // 入力項目（ご予約者・交通手段・専用特典の行は上に出したので除く）
    ...splitExtraOptions(b.detail).map((o) => `${o.label}: ${o.value}`),
    ...(b.detail.notes ? [`備考: ${b.detail.notes}`] : []),
    // 添付ファイル（2026-10-07）: 名前だけ（ファイルはメールに付けない・§10.1）
    ...[attachmentLine(b.attachment_names ?? [], audience === 'facility' ? '（PMS の予約詳細でご確認ください）' : '（予約一覧でご確認いただけます）')].filter(
      (l): l is string => !!l
    ),
    ...((b.bath_tax_amount ?? 0) > 0
      ? [
          `宿泊料金: ${yen(b.total_amount)}（税込）`,
          ...((b.prepay_discount_amount ?? 0) > 0 ? [`予約時決済割引: -${yen(b.prepay_discount_amount)}`] : []),
          `入湯税: ${yen(b.bath_tax_amount)}`,
          `合計: ${yen(chargeAmountOf(b))}`
        ]
      : [`合計: ${yen(b.total_amount)}（税込）`]),
    ...(b.payment_method_name
      ? [
          `お支払: ${b.payment_method_name}${
            depositSummary(b)
              ? `（${depositSummary(b)}）`
              : b.payment_status === 'paid'
              ? `（お支払い済み ${yen(b.paid_amount ?? chargeAmountOf(b))}）`
              : b.payment_status === 'scheduled'
                ? `（チェックアウト日に${b.card_label ? ` ${b.card_label} へ` : ''}請求します）`
                : b.payment_status === 'charge_failed'
                  ? '（カードへの請求ができませんでした）'
                  : b.payment_status === 'refunded'
                ? b.refund_amount != null && b.refund_amount < (b.paid_amount ?? chargeAmountOf(b))
                  ? `（${yen(b.refund_amount)} 返金済み）`
                  : '（全額返金済み）'
                : b.payment_status === 'refund_failed'
                  ? '（返金できませんでした。宿で対応します）'
                  : ''
          }`
        ]
      : []),
    ...cancelFeeLines(b)
  ];
  return lines;
}

/**
 * デポジット予約のお支払の説明（メール・一覧）。デポジットでない・支払前は null。
 * 「デポジット 30,450円 お支払い済み・残額 71,050円（請求書）」。取消・返金の後は返金の説明を優先する（null）。
 */
export function depositSummary(
  b: Pick<PartnerBookingRow, 'payment_option' | 'payment_status' | 'total_amount' | 'bath_tax_amount' | 'prepay_discount_amount' | 'deposit_amount' | 'paid_amount' | 'remainder_option' | 'status'>
): string | null {
  const st = depositStateOf(b);
  if (!st || b.payment_status !== 'paid' || b.status === 'cancelled') return null;
  return `デポジット ${yen(st.deposit)} お支払い済み・残額 ${yen(st.remainder)}（${isDepositRemainderBilled(b.remainder_option) ? '請求書' : '現地'}）`;
}

// 取消済みの予約のキャンセル料（メール・一覧）。0円なら「なし」を明記する
export function cancelFeeLines(b: PartnerBookingRow): string[] {
  if (b.status !== 'cancelled' || !b.cancel_fee_settlement) return [];
  const fee = b.cancel_fee ?? 0;
  const kept = cancelKeptNote(b);
  const adminLines = (): string[] => (kept ? [kept] : []);
  if (fee <= 0) return [`キャンセル料: なし${b.cancel_fee_waived ? '（免除）' : ''}`, ...adminLines()];
  const how = cancelFeeSettlementLabel(b);
  return [`キャンセル料: ${yen(fee)}（${cancelFeeBasisLabel(b)}・不課税）${how ? ` ${how}` : ''}`, ...adminLines()];
}

/**
 * 取消済みの予約時決済・デポジットで、キャンセル料より大きい額（事務手数料・予約時決済割引の分）を差し引いたときの一文（2026-10-07）。
 * キャンセル料をそのまま差し引いた・後払いの予約は null。メール・取引先の予約一覧・管理画面に出す。
 */
export function cancelKeptNote(b: PartnerBookingRow): string | null {
  if (b.status !== 'cancelled' || (b.cancel_fee_settlement !== 'refund' && b.cancel_fee_settlement !== 'deposit')) return null;
  const r = partnerRefundOf(b, b.cancel_fee ?? 0, !!b.cancel_fee_waived);
  if (r.reason === 'admin_fee')
    return `事務手数料: ${yen(r.adminFee)}（予約時決済の取消で返金しない ${r.adminFeePercent ?? ''}%・キャンセル料より大きいためこちらを差し引き）→ 返金 ${yen(r.refund)}`;
  if (r.reason === 'prepay_discount') return `予約時決済割引の分: ${yen(r.kept)}（キャンセル料より大きいためこちらを差し引き）→ 返金 ${yen(r.refund)}`;
  return null;
}

// 「2日前の取消 30%」「不泊 100%」「金額指定」
export function cancelFeeBasisLabel(b: Pick<PartnerBookingRow, 'cancel_fee_basis' | 'cancel_fee_rate'>): string {
  const basis = b.cancel_fee_basis ?? '';
  if (b.cancel_fee_rate == null) return basis || '宿の判断';
  return `${basis === '不泊' ? '不泊' : `${basis}の取消`} ${b.cancel_fee_rate}%`;
}

export function cancelFeeSettlementLabel(b: PartnerBookingRow): string {
  switch (b.cancel_fee_settlement) {
    case 'invoice':
      return `→ ${invoiceMonthLabel(b.check_out_date)}分の請求書でご請求${b.cancel_fee_status === 'charge_failed' ? '（カードへの請求ができなかったため）' : ''}`;
    case 'card':
      return b.cancel_fee_status === 'charged' ? '→ ご登録のカードへ請求済み' : '→ ご登録のカードへ請求';
    case 'refund':
      return '→ お支払い済みの金額から差し引き';
    case 'deposit': {
      // デポジットから充当。不足分は精算先にかかわらず請求書へ（2026-10-07 変更・旧 N3 廃止）
      const r = partnerRefundOf(b, b.cancel_fee ?? 0, !!b.cancel_fee_waived);
      if (r.shortage <= 0) return '→ お支払い済みのデポジットから充当';
      return `→ デポジットから充当（超える ${yen(r.shortage)} は ${invoiceMonthLabel(b.check_out_date)}分の請求書でご請求）`;
    }
    default:
      return '';
  }
}

// 取引先払い（宿泊料金・入湯税を取引先へ月末に請求し、お客様には請求しない）予約の、宿への注意書き（2026-10-02 指示）。
// 判定は請求書と同じ isBillablePaymentOption（月末締め翌月末銀行振込、または「請求書で精算」の自由入力の支払方法）。
export function partnerBilledNotice(
  partner: Pick<PartnerRow, 'name' | 'booking_settings'>,
  b: Pick<PartnerBookingRow, 'payment_option'> & Partial<Pick<PartnerBookingRow, 'total_amount' | 'bath_tax_amount' | 'prepay_discount_amount' | 'deposit_amount' | 'paid_amount' | 'remainder_option'>>
): string | null {
  // デポジット（Phase 3b）: 予約時に受けた額と、残額の精算先（請求書なら取引先へ・現地ならお客様から）
  const dep = b.total_amount != null ? depositStateOf({ ...b, total_amount: b.total_amount }) : null;
  if (dep) {
    return isDepositRemainderBilled(b.remainder_option)
      ? `【ご請求】デポジット ${yen(dep.deposit)} はお支払い済み。残額 ${yen(dep.remainder)} は ${partner.name} 様へ月末にご請求します。お客様（ご宿泊者）には請求しないでください。`
      : `【デポジット】${yen(dep.deposit)} はお支払い済みです。残額 ${yen(dep.remainder)} は現地でお客様からお受け取りください。`;
  }
  if (!isBillablePaymentOption(b.payment_option, partner.booking_settings)) return null;
  return `【ご請求】宿泊料金・入湯税は ${partner.name} 様へ月末にご請求します。お客様（ご宿泊者）には請求しないでください。`;
}

/**
 * メールの中の予約一覧のリンク（純関数）。?f=<その予約の施設 slug> を付け、開くとその施設が選ばれる（§7.8・2026-10-09 複数施設化）。
 * 1施設の取引先でも付ける（付いていても画面は変わらない）。
 */
export const partnerBookingsUrl = (origin: string, partner: Pick<PartnerContext, 'url_token' | 'facility_slug'>) =>
  `${origin}/p/${partner.url_token}/bookings${partner.facility_slug ? `?f=${encodeURIComponent(partner.facility_slug)}` : ''}`;

async function sendBookingMails(
  db: SupabaseClient,
  viewer: AnyPartner,
  b: PartnerBookingRow,
  kind: 'new' | 'cancelled',
  origin: string,
  accountId: string | null
): Promise<boolean> {
  // 差出人・宿への通知先（notifyEmails）・取引先向けの設定は予約の施設のもの
  const partner = await contextForBooking(db, viewer, b);
  const s = partner.booking_settings;
  // 予約確認には添付ファイルの名前の行を足す（2026-10-07・機能が off なら空）
  if (kind === 'new') b = { ...b, attachment_names: await bookingAttachmentNames(db, b.partner_id, b.id) };
  // 施設名は差出人名と同じもの（core.facilities.name）。合成で空なら差出人名で代える
  const facilityName = partner.facility_name || (await partnerMailSender(db, partner.facility_id)).fromName;
  const title = kind === 'new' ? 'ご予約を承りました' : 'ご予約を取り消しました';
  const summary = bookingSummaryLines(b);
  const listUrl = partnerBookingsUrl(origin, partner);
  let sent = false;

  // 取引先へ（予約者のメールを最優先に、予約したログインIDのメール＋取引先の連絡先メール）。
  // 宿泊者のメール（b.guest_email）へは送らない（2026-10-01 指示: 予約確認・取消・お支払いの連絡は予約者＝ご担当者へだけ）。
  if (s.notifyPartner) {
    const to = await partnerRecipients(db, partner, b, accountId);
    if (to.length) {
      const text = [`${partner.name} 様`, '', `${facilityName} です。以下の内容で${title}。`, '', ...summary, '', `予約一覧: ${listUrl}`].join('\n');
      const html = `<p>${escapeHtml(partner.name)} 様</p><p>${escapeHtml(facilityName)} です。以下の内容で${title}。</p><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(summary.join('\n'))}</pre><p>予約一覧: <a href="${escapeHtml(listUrl)}">${escapeHtml(listUrl)}</a></p>`;
      const r = await sendPartnerMail(db, partner.facility_id, { to, subject: `【${facilityName}】${title}（${b.booking_code}）`, html, text });
      sent = sent || r.sent;
    }
  }

  // 宿へ
  if (s.notifyEmails.length) {
    const head = kind === 'new' ? `取引先「${partner.name}」から予約が入りました。` : `取引先予約が取り消されました（${b.cancelled_by === 'staff' ? 'スタッフの操作' : '取引先の操作'}）。`;
    // 取引先払いの予約は、お客様に請求しないよう先頭付近で目立たせる
    const billed = partnerBilledNotice(partner, b);
    // 受付枠（与信）を超えて受けた予約（Phase 3a・止めずに受けて印を付ける）。新規の通知だけ件名・本文で目立たせる
    const creditLine = kind === 'new' ? creditOverLine(b.credit_result) : null;
    const facilitySummary = bookingSummaryLines(b, 'facility');
    const text = [head, ...(creditLine ? ['', creditLine] : []), ...(billed ? ['', billed] : []), '', ...facilitySummary, '', 'PMS には1分ほどで取り込まれます（予約経路: 取引先予約（RMS））。'].join('\n');
    const billedHtml = billed
      ? `<p style="margin:12px 0;padding:8px 12px;border:2px solid #b91c1c;border-radius:6px;background:#fef2f2;color:#b91c1c;font-weight:bold">${escapeHtml(billed)}</p>`
      : '';
    const creditHtml = creditLine
      ? `<p style="margin:12px 0;padding:8px 12px;border:2px solid #b45309;border-radius:6px;background:#fffbeb;color:#92400e;font-weight:bold">${escapeHtml(creditLine)}</p>`
      : '';
    const html = `<p>${escapeHtml(head)}</p>${creditHtml}${billedHtml}<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(facilitySummary.join('\n'))}</pre><p style="color:#666;font-size:12px">PMS には1分ほどで取り込まれます（予約経路: 取引先予約（RMS））。</p>`;
    const r = await sendFacilityNotice(db, partner.facility_id, {
      to: s.notifyEmails,
      subject: `${creditLine ? creditOverSubjectPrefix(b.credit_result) : ''}【取引先予約${kind === 'new' ? '' : '・取消'}】${partner.name} ${b.check_in_date} ${b.guest_name} 様（${b.booking_code}）`,
      html,
      text
    });
    sent = sent || r.sent;
  }
  return sent;
}

// 取引先宛てメールの宛先（予約者 → 予約したログインIDのメール → 取引先の連絡先。重複は1通）。
// アカウントは partner_id でも絞る（service_role で読むため、別の取引先のアカウントのメールを拾わない）。
// 宿泊者のメール（guest_email）は意図して含めない。
async function partnerRecipients(
  db: SupabaseClient,
  partner: Pick<PartnerRow, 'id' | 'contact_email'>,
  b: PartnerBookingRow,
  accountId: string | null
): Promise<string[]> {
  let accountEmail: string | null = null;
  if (accountId) {
    const { data } = await db.from('rms_partner_accounts').select('email').eq('id', accountId).eq('partner_id', partner.id).maybeSingle();
    accountEmail = (data?.email as string | null | undefined) ?? null;
  }
  return partnerMailRecipients([b.detail.booker?.email, accountEmail, partner.contact_email]);
}

// チェックアウト日決済の請求失敗（宿・取引先へ）。
async function sendChargeFailedMails(db: SupabaseClient, viewer: AnyPartner, b: PartnerBookingRow, origin: string, reason: string): Promise<boolean> {
  const partner = await contextForBooking(db, viewer, b);
  const s = partner.booking_settings;
  const facilityName = partner.facility_name || (await partnerMailSender(db, partner.facility_id)).fromName;
  const summary = bookingSummaryLines(b);
  const listUrl = partnerBookingsUrl(origin, partner);
  let sent = false;
  // 予約者・ログインID・取引先の連絡先へ（宿泊者のメールへは送らない）
  const partnerTo = await partnerRecipients(db, partner, b, b.account_id);
  if (partnerTo.length) {
    const lead = `${facilityName} です。ご予約（${b.booking_code}）のチェックアウト日のお支払いで、ご登録のカードに請求できませんでした（${reason}）。お手数ですが、予約一覧の「カードを登録し直す」から別のカードをご登録ください。`;
    const text = [`${partner.name} 様`, '', lead, '', ...summary, '', `予約一覧: ${listUrl}`].join('\n');
    const html = `<p>${escapeHtml(partner.name)} 様</p><p>${escapeHtml(lead)}</p><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(summary.join('\n'))}</pre><p>予約一覧: <a href="${escapeHtml(listUrl)}">${escapeHtml(listUrl)}</a></p>`;
    const r = await sendPartnerMail(db, partner.facility_id, { to: partnerTo, subject: `【${facilityName}】カードへのご請求ができませんでした（${b.booking_code}）`, html, text });
    sent = sent || r.sent;
  }
  if (s.notifyEmails.length) {
    const head = `取引先「${partner.name}」の予約で、チェックアウト日のカード請求に失敗しました（${reason}）。取引先にはカードの再登録をお願いするメールを送りました。Book の管理画面（取引先）から再請求するか、現地でのお支払いをご案内ください。`;
    const text = [head, '', ...summary].join('\n');
    const html = `<p>${escapeHtml(head)}</p><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(summary.join('\n'))}</pre>`;
    const r = await sendFacilityNotice(db, partner.facility_id, { to: s.notifyEmails, subject: `【取引先予約・請求失敗】${partner.name} ${b.check_in_date} ${b.guest_name} 様（${b.booking_code}）`, html, text });
    sent = sent || r.sent;
  }
  return sent;
}
