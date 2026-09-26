// 取引先予約: 見積もり（特別レートでの料金と残室）・確定・一覧・取消・通知メール。
//
// 予約の作成と取消は autumn-shared の DB 関数（public.rms_partner_create_booking / rms_partner_cancel_booking）が
// 1トランザクションで行い、直販予約と同じ電文で PMS へ届ける（migration 20260926054852）。
// ここは「取引先に見せた料金で・受付ルールの範囲で」受け付けるための前後の処理を持つ。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyPrepayDiscount,
  canBookFor,
  describePrepayDiscount,
  hasPrepayDiscount,
  isStripePaymentOption,
  paymentOptionLabel,
  type PartnerPaymentOptionId,
  canPartnerCancel,
  describeDeadline,
  resolveOptionAnswers,
  type PartnerBookingGuestInput
} from '$lib/partner-booking';
import { partnerMailSender, sendFacilityNotice, sendPartnerMail } from './mail';
import {
  cardLabelOf,
  chargeSavedCard,
  createCheckoutSession,
  createCustomer,
  createRefund,
  createSetupSession,
  listRefunds,
  onlinePaymentReady,
  retrieveCheckoutSession,
  STRIPE_APP,
  STRIPE_PURPOSE_PARTNER_BOOKING,
  StripeError,
  stripeTestMode,
  type CheckoutSession,
  type StripePaymentMethod
} from '$lib/server/stripe';
import { addDaysIso, findPartnerByUrlToken, logPartnerAccess, PartnerStoreError, todayJst, type PartnerContext, type PartnerRow } from './store';
import { clampPartnerRange, loadPartnerRates, PARTNER_MAX_RANGE_DAYS } from './rates';

type AnySchema = { schema: (s: string) => SupabaseClient };
const pmsDb = (db: SupabaseClient) => (db as unknown as AnySchema).schema('pms');
const coreDb = (db: SupabaseClient) => (db as unknown as AnySchema).schema('core');

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------------------------------------------------------------------------
// 支払方法・受付状態
// ---------------------------------------------------------------------------

// オンライン決済（Stripe）は STRIPE_SECRET_KEY があるときだけ使える。無ければ設定で許可していても
// 取引先の画面には出さない（銀行振込だけの取引先はそのまま予約できる）。
export { onlinePaymentReady };

// 取引先が予約時に選べる支払方法（設定で許可したもののうち、いま使えるもの）。
export function availablePaymentOptions(partner: Pick<PartnerRow, 'booking_settings'>): PartnerPaymentOptionId[] {
  return partner.booking_settings.paymentOptions.filter((id) => !isStripePaymentOption(id) || onlinePaymentReady());
}

// 限定URLから予約できる状態か（受付オン・使える支払方法が1つ以上）。
export function isPartnerBookingOpen(partner: Pick<PartnerRow, 'booking_enabled' | 'booking_settings'>): boolean {
  return partner.booking_enabled && availablePaymentOptions(partner).length > 0;
}

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
export const chargeAmountOf = (b: Pick<PartnerBookingRow, 'total_amount' | 'bath_tax_amount'>) => b.total_amount + (b.bath_tax_amount ?? 0);

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
    }
  | { ok: false; message: string };

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

export async function quotePartnerBooking(db: SupabaseClient, partner: PartnerContext, t: BookingTarget): Promise<BookingQuote> {
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
  const [rates, remaining, bathRule] = await Promise.all([
    loadPartnerRates(db, partner, { from: range.from, to: range.to }, { rooms: [t.roomCode], guests }),
    roomTypeRemaining(db, partner.facility_id, t.roomCode, t.checkIn, addDaysIso(lastNight, 1)),
    bathTaxRule(db, partner.facility_id)
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
    bathTax: bathRule.enabled ? bathRule.amount * rooms.reduce((s, r) => s + r.adults, 0) * nights : 0,
    prepay: prepayTotal == null ? null : { total: prepayTotal, discount: total - prepayTotal, label: describePrepayDiscount(d) },
    remaining: remaining.min
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
  guest: PartnerBookingGuestInput;
  arrival: string;
  notes: string;
  answers: Record<string, string>;
};

// checkoutUrl があれば、オンライン決済の画面へ送る（支払完了で予約確定・PMS へ）。
export type CreatedBooking = { id: string; bookingCode: string; total: number; emailed: boolean; checkoutUrl?: string };

const PHONE_RE = /^[0-9+\-() ]{8,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function friendlyRpcError(message: string): string {
  const m = message.match(/sold_out:(\d{4}-\d{2}-\d{2}):(\d+)/);
  if (m) return `${m[1]} は満室になりました（残り ${m[2]} 室）。室数・日程を変えてお試しください。`;
  if (message.includes('booking_disabled')) return '現在ご予約を受け付けていません。';
  if (message.includes('past_date')) return '過去の日付はご予約いただけません。';
  if (message.includes('invalid_adults')) return '1室あたりの人数がお部屋の定員を超えています。';
  if (message.includes('guest_name_required')) return '宿泊者のお名前を入力してください。';
  if (message.includes('guest_phone_required')) return '宿泊者の電話番号を入力してください。';
  if (message.includes('invalid_email')) return 'メールアドレスの形式が正しくありません。';
  if (message.includes('room_type_not_found')) return 'このお部屋は現在ご予約いただけません。';
  if (message.includes('channel_not_found') || message.includes('does not exist') || message.includes('Could not find')) {
    return '予約の受付準備ができていません（宿へお問い合わせください）。';
  }
  return 'ご予約を確定できませんでした。時間をおいてもう一度お試しください。';
}

export async function createPartnerBooking(
  db: SupabaseClient,
  partner: PartnerContext,
  account: { id: string; login_id: string },
  input: CreateBookingInput,
  meta: { ip: string | null; origin: string }
): Promise<CreatedBooking> {
  const s = partner.booking_settings;
  if (!partner.booking_enabled) throw new PartnerStoreError('現在ご予約を受け付けていません。', 403);
  const payOptions = availablePaymentOptions(partner);
  if (!payOptions.length) throw new PartnerStoreError('予約の受付準備ができていません（宿へお問い合わせください）。', 409);
  // 支払方法が1つだけならそれ。複数なら取引先が選んだもの（許可されたものに限る）。
  const paymentOption = payOptions.length === 1 ? payOptions[0] : payOptions.find((id) => id === input.paymentOption);
  if (!paymentOption) throw new PartnerStoreError('お支払方法を選んでください。');
  if (!canBookFor(input.checkIn, s)) {
    throw new PartnerStoreError(`この宿泊日のご予約は締め切りました（宿泊日の${describeDeadline(s.leadDays, s.cutoffHour)}）。`);
  }
  if (input.nights > s.maxNights) throw new PartnerStoreError(`1回のご予約は ${s.maxNights} 泊までです。`);
  if (input.rooms.length > s.maxRooms) throw new PartnerStoreError(`1回のご予約は ${s.maxRooms} 室までです。`);

  const g = input.guest;
  if (!g.familyName.trim()) throw new PartnerStoreError('宿泊者（代表者）の姓を入力してください。');
  if (!PHONE_RE.test(g.phone.trim())) throw new PartnerStoreError('電話番号を正しく入力してください。');
  if (g.email.trim() && !EMAIL_RE.test(g.email.trim())) throw new PartnerStoreError('メールアドレスの形式が正しくありません。');
  const answers = resolveOptionAnswers(s.options, input.answers);
  if (!answers.ok) throw new PartnerStoreError(answers.message);

  const quote = await quotePartnerBooking(db, partner, input);
  if (!quote.ok) throw new PartnerStoreError(quote.message);
  // 予約時決済の割引（単価に当てる）。割引したことは PMS の備考・メールにも出す。
  const discount = paymentOption === 'online' && quote.prepay ? quote.prepay : null;
  const rooms = discount ? discountRooms(quote.rooms, s.prepayDiscount) : quote.rooms;
  const optionValues = discount
    ? [...answers.values, { label: '予約時決済割引', value: `${discount.label}（-${discount.discount.toLocaleString('ja-JP')}円）` }]
    : answers.values;

  const { data, error } = await db.rpc('rms_partner_create_booking', {
    p: {
      partner_id: partner.id,
      account_id: account.id,
      booked_by: account.login_id,
      room_code: quote.roomCode,
      room_name: quote.roomName,
      plan_code: quote.planCode,
      plan_name: quote.planName,
      meal_type: quote.mealType,
      check_in: quote.checkIn,
      check_out: quote.checkOut,
      rooms: rooms.map((r) => ({ adults: r.adults, nights: r.nights })),
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
      payment_label: paymentOptionLabel(paymentOption),
      // オンライン決済は支払待ちの仮押さえで作り、支払完了（予約時決済）・カード登録完了（チェックイン日決済）で
      // 確定・PMS へ（DB 関数 rms_partner_mark_paid / rms_partner_mark_card_saved）
      await_payment: isStripePaymentOption(paymentOption)
    }
  });
  if (error) throw new PartnerStoreError(friendlyRpcError(error.message), 409);
  const created = data as { id: string; booking_code: string; total_amount: number; status?: string };
  // 入湯税を台帳に（決済画面・PMS への電文の請求額＝宿泊料金＋入湯税。電文は支払完了・カード登録完了のときに組むので、その前に入れる）
  if (quote.bathTax > 0) await db.from('rms_partner_bookings').update({ bath_tax_amount: quote.bathTax }).eq('id', created.id);

  if (created.status === 'pending_payment') {
    const pending = await getPartnerBooking(db, partner.id, created.id);
    try {
      if (!pending) throw new Error('予約が見つかりません');
      const url = await startCheckout(db, partner, pending, meta.origin);
      await logPartnerAccess(db, {
        partnerId: partner.id,
        accountId: account.id,
        channel: 'web',
        action: 'book_pending',
        detail: { bookingCode: created.booking_code, total: created.total_amount },
        ip: meta.ip
      });
      return { id: created.id, bookingCode: created.booking_code, total: created.total_amount, emailed: false, checkoutUrl: url };
    } catch (e) {
      // 決済画面を作れなければ仮押さえを解放して、やり直してもらう
      await db.rpc('rms_partner_cancel_booking', { p_partner_booking_id: created.id, p_by: 'partner', p_reason: '決済画面を作れませんでした' });
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
// オンライン決済（Stripe Checkout）
// ---------------------------------------------------------------------------

// 支払待ちの予約の決済画面を作る（開いている画面があればそれを使う）。戻り値は決済画面の URL。
async function startCheckout(db: SupabaseClient, partner: PartnerContext, b: PartnerBookingRow, origin: string): Promise<string> {
  if (b.payment_option === 'online_checkin') return startCardSetup(db, partner, b, origin);
  if (b.stripe_session_id) {
    const cur = await retrieveCheckoutSession(b.stripe_session_id).catch(() => null);
    if (cur?.status === 'open' && cur.url) return cur.url;
  }
  const base = `${origin}/p/${partner.url_token}/bookings`;
  const session = await createCheckoutSession({
    amount: b.total_amount,
    bathTax: b.bath_tax_amount ?? 0,
    productName: `${partner.facility_name} ご宿泊（${b.booking_code}）`,
    description: `${b.check_in_date} から ${b.nights}泊・${b.room_name ?? ''} ${b.room_count}室・${b.guest_name} 様`,
    successUrl: `${base}?paid={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}?unpaid=${encodeURIComponent(b.id)}`,
    customerEmail: null,
    metadata: {
      app: STRIPE_APP,
      purpose: STRIPE_PURPOSE_PARTNER_BOOKING,
      partner_booking_id: b.id,
      booking_code: b.booking_code,
      partner_id: partner.id,
      facility: partner.facility_slug
    },
    expiresInMinutes: 30,
    idempotencyKey: `rms-partner-checkout-${b.id}-${Date.now()}`
  });
  await db.from('rms_partner_bookings').update({ stripe_session_id: session.id }).eq('id', b.id);
  if (!session.url) throw new Error('決済画面の URL がありません');
  return session.url;
}

// チェックイン日決済: カード登録の画面を作る（予約時・カードの登録し直しの両方）。戻り値は画面の URL。
async function startCardSetup(db: SupabaseClient, partner: PartnerContext, b: PartnerBookingRow, origin: string): Promise<string> {
  let customer = b.stripe_customer_id;
  if (!customer) {
    customer = (
      await createCustomer({
        name: `${b.guest_name}（${partner.name}）`,
        email: partner.contact_email,
        metadata: { app: STRIPE_APP, purpose: STRIPE_PURPOSE_PARTNER_BOOKING, partner_booking_id: b.id, booking_code: b.booking_code, partner_id: partner.id },
        idempotencyKey: `rms-partner-customer-${b.id}`
      })
    ).id;
    await db.from('rms_partner_bookings').update({ stripe_customer_id: customer }).eq('id', b.id);
  }
  const base = `${origin}/p/${partner.url_token}/bookings`;
  const session = await createSetupSession({
    customer,
    description: `${partner.facility_name} ご宿泊（${b.booking_code}）${b.check_in_date} チェックイン日に ${chargeAmountOf(b).toLocaleString('ja-JP')}円 を請求`,
    consentText: cardConsentText(partner.facility_name, b),
    successUrl: `${base}?card={CHECKOUT_SESSION_ID}`,
    cancelUrl: b.status === 'pending_payment' ? `${base}?unpaid=${encodeURIComponent(b.id)}` : base,
    metadata: {
      app: STRIPE_APP,
      purpose: STRIPE_PURPOSE_PARTNER_BOOKING,
      partner_booking_id: b.id,
      booking_code: b.booking_code,
      partner_id: partner.id,
      facility: partner.facility_slug
    },
    expiresInMinutes: 30,
    idempotencyKey: `rms-partner-setup-${b.id}-${Date.now()}`
  });
  await db.from('rms_partner_bookings').update({ stripe_session_id: session.id }).eq('id', b.id);
  if (!session.url) throw new Error('カード登録画面の URL がありません');
  return session.url;
}

// カード登録画面に出す同意文（請求日・金額・内訳）。登録完了時に同じ文面を台帳に残す。
export function cardConsentText(facilityName: string, b: Pick<PartnerBookingRow, 'booking_code' | 'check_in_date' | 'total_amount' | 'bath_tax_amount'>): string {
  const [y, m, d] = b.check_in_date.split('-').map(Number);
  const bath = b.bath_tax_amount ?? 0;
  return (
    `${facilityName}のご宿泊（予約番号 ${b.booking_code}）について、チェックイン日の ${y}年${m}月${d}日に、` +
    `このカードへ ${yen(chargeAmountOf(b))}（宿泊料金 ${yen(b.total_amount)}${bath > 0 ? `・入湯税 ${yen(bath)}` : ''}）を請求することに同意します。` +
    '取消の期限内に予約を取り消した場合は請求しません。'
  );
}

// チェックイン日決済で、カードを登録し直せる状態か（請求前・請求失敗）。
export const canUpdateCard = (b: Pick<PartnerBookingRow, 'status' | 'payment_option' | 'payment_status'>) =>
  b.status === 'confirmed' && b.payment_option === 'online_checkin' && (b.payment_status === 'scheduled' || b.payment_status === 'charge_failed');

// 取引先の予約一覧の「お支払いへ進む」「カードを登録し直す」。
export async function resumeOnlinePayment(db: SupabaseClient, partner: PartnerContext, bookingId: string, origin: string): Promise<string> {
  const b = await getPartnerBooking(db, partner.id, bookingId);
  if (b && canUpdateCard(b)) return startCardSetup(db, partner, b, origin);
  if (!b || b.status !== 'pending_payment') throw new PartnerStoreError('お支払い待ちの予約ではありません。');
  if (b.payment_expires_at && new Date(b.payment_expires_at).getTime() <= Date.now()) {
    throw new PartnerStoreError('お支払いの期限が過ぎたため、仮押さえを解除しました。もう一度ご予約ください。');
  }
  return startCheckout(db, partner, b, origin);
}

async function partnerForBooking(db: SupabaseClient, bookingId: string): Promise<{ partner: PartnerContext; booking: PartnerBookingRow } | null> {
  const { data } = await db.from('rms_partner_bookings').select('partner_id').eq('id', bookingId).maybeSingle();
  if (!data?.partner_id) return null;
  const { data: row } = await db.from('rms_partners').select('url_token').eq('id', data.partner_id).maybeSingle();
  if (!row?.url_token) return null;
  const partner = await findPartnerByUrlToken(db, String(row.url_token));
  const booking = partner ? await getPartnerBooking(db, partner.id, bookingId) : null;
  return partner && booking ? { partner, booking } : null;
}

export type PaymentResult = {
  status: 'paid' | 'already' | 'unpaid' | 'refunded_late' | 'unknown' | 'card_saved' | 'card_updated' | 'card_late';
  bookingCode?: string;
  // カード登録し直し後、その場で請求した結果
  charge?: ChargeResult;
};

// 支払完了の確認（Webhook と、決済画面からの戻り先の両方から呼ぶ。何度呼んでも同じ結果）。
export async function confirmOnlinePayment(db: SupabaseClient, sessionId: string, origin: string): Promise<PaymentResult> {
  const session = await retrieveCheckoutSession(sessionId, true);
  const bookingId = session.metadata?.partner_booking_id;
  if (!bookingId) return { status: 'unknown' };
  const ctx = await partnerForBooking(db, bookingId);
  if (!ctx) return { status: 'unknown' };
  if (session.mode === 'setup') return confirmCardSetup(db, ctx, session, origin);
  if (session.payment_status !== 'paid') return { status: 'unpaid', bookingCode: ctx.booking.booking_code };

  const { data, error } = await db.rpc('rms_partner_mark_paid', {
    p_partner_booking_id: bookingId,
    p_session_id: session.id,
    p_payment_intent: session.payment_intent,
    p_amount: session.amount_total ?? chargeAmountOf(ctx.booking)
  });
  if (error) throw new PartnerStoreError(`支払の記録に失敗しました（${error.message}）`, 500);
  const result = String(data);
  const after = (await getPartnerBooking(db, ctx.partner.id, bookingId)) ?? ctx.booking;
  if (result === 'paid') {
    await logPartnerAccess(db, { partnerId: ctx.partner.id, accountId: after.account_id, channel: 'web', action: 'paid', detail: { bookingCode: after.booking_code, amount: session.amount_total } });
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

// チェックイン日決済: カード登録の完了を確かめて予約を確定する（Webhook と戻り先の両方から。何度呼んでも同じ結果）。
async function confirmCardSetup(
  db: SupabaseClient,
  ctx: { partner: PartnerContext; booking: PartnerBookingRow },
  session: CheckoutSession,
  origin: string
): Promise<PaymentResult> {
  const code = ctx.booking.booking_code;
  const si = session.setup_intent && typeof session.setup_intent === 'object' ? session.setup_intent : null;
  if (session.status !== 'complete' || !si || si.status !== 'succeeded') return { status: 'unpaid', bookingCode: code };
  const pm = si.payment_method && typeof si.payment_method === 'object' ? si.payment_method : null;
  const pmId = pm?.id ?? (typeof si.payment_method === 'string' ? si.payment_method : null);
  if (!pmId || !session.customer) return { status: 'unpaid', bookingCode: code };
  const before = ctx.booking;
  const { data, error } = await db.rpc('rms_partner_mark_card_saved', {
    p_partner_booking_id: before.id,
    p_session_id: session.id,
    p_customer: session.customer,
    p_payment_method: pmId,
    p_card_label: cardLabelOf(pm as StripePaymentMethod | null)
  });
  if (error) throw new PartnerStoreError(`カード登録の記録に失敗しました（${error.message}）`, 500);
  const result = String(data);
  if (result === 'saved' || result === 'updated') {
    // 同意の記録（カード登録画面に出した文面と、登録を完了した日時）
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
    // 請求に失敗していた予約は、チェックイン日を迎えていればその場で請求し直す
    const charge =
      before.payment_status === 'charge_failed' && after.check_in_date <= todayJst()
        ? await chargeBooking(db, ctx.partner, after, origin, 'card_updated')
        : undefined;
    return { status: 'card_updated', bookingCode: code, charge };
  }
  if (result === 'not_pending') return { status: 'card_late', bookingCode: code };
  return { status: 'already', bookingCode: code };
}

export type ChargeResult = { status: 'paid' | 'failed' | 'skipped'; message?: string };

type AnyPartner = PartnerContext | (PartnerRow & { facility_name?: string; url_token?: string });

/**
 * チェックイン日決済: 登録カードに請求する（定期処理・スタッフの再請求・カード登録し直しから）。
 * 同じ予約を同時に2回請求しないよう、charge_attempts を条件付きで進めてから Stripe を呼ぶ
 * （Stripe の冪等キーも試行回数ごと）。成功 → rms_partner_mark_charged（PMS へ paid 電文）。
 * 失敗 → payment_status='charge_failed' にして宿・取引先へメール。
 */
export async function chargeBooking(
  db: SupabaseClient,
  partner: AnyPartner,
  b: PartnerBookingRow,
  origin: string,
  trigger: 'cron' | 'staff' | 'card_updated'
): Promise<ChargeResult> {
  if (b.status !== 'confirmed' || b.payment_option !== 'online_checkin') return { status: 'skipped', message: 'チェックイン日決済の予約ではありません。' };
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

  const facilityName = 'facility_name' in partner && partner.facility_name ? partner.facility_name : '';
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

// 定期処理（毎時）: チェックイン日を迎えた「チェックイン日決済」の予約に請求する。請求失敗の予約は自動では再請求しない。
export async function chargeDueBookings(db: SupabaseClient, origin: string): Promise<{ target: number; paid: number; failed: number; skipped: number }> {
  const { data } = await db
    .from('rms_partner_bookings')
    .select('id')
    .eq('status', 'confirmed')
    .eq('payment_option', 'online_checkin')
    .eq('payment_status', 'scheduled')
    .lte('check_in_date', todayJst())
    .order('check_in_date')
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

// 支払済みの予約を全額返金して台帳に結果を残す。
async function refundBooking(db: SupabaseClient, b: PartnerBookingRow, reason: string): Promise<boolean> {
  const { data } = await db.from('rms_partner_bookings').select('stripe_payment_intent_id, payment_status').eq('id', b.id).maybeSingle();
  const intent = data?.stripe_payment_intent_id as string | null | undefined;
  if (!intent || data?.payment_status === 'refunded') return false;
  let refundId: string;
  try {
    refundId = (await createRefund(intent, `rms-partner-refund-${b.id}`, { partner_booking_id: b.id, booking_code: b.booking_code, reason })).id;
  } catch (e) {
    await db
      .from('rms_partner_bookings')
      .update({ payment_status: 'refund_failed', refund_error: e instanceof Error ? e.message.slice(0, 500) : String(e) })
      .eq('id', b.id);
    return false;
  }
  // 返金の記録と、PMS に送った予約なら返金電文（PMS が請求書にマイナスの入金行を起こす）。
  const { error } = await db.rpc('rms_partner_mark_refunded', { p_partner_booking_id: b.id, p_refund_id: refundId });
  if (error) {
    // 返金そのものは成功している。記録だけは残す（PMS の請求書は人が直す）。
    console.error('[partner-booking] 返金の記録に失敗:', error.message);
    await db.from('rms_partner_bookings').update({ payment_status: 'refunded', stripe_refund_id: refundId, refund_error: null }).eq('id', b.id);
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
  };
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
  // PMS 側の状態（チェックイン済みなら取り消せない）
  checkedIn?: boolean;
};

const BOOKING_COLUMNS =
  'id, partner_id, partner_name, account_id, booked_by, booking_code, status, stay_ids, room_code, room_name, plan_code, plan_name, meal_type, check_in_date, check_out_date, nights, room_count, adult_total, guest_name, guest_kana, guest_phone, guest_email, total_amount, bath_tax_amount, card_consent_text, card_consent_at, payment_method_name, payment_option, payment_status, payment_expires_at, paid_at, paid_amount, stripe_session_id, refund_error, stripe_customer_id, stripe_payment_method_id, card_label, charge_attempts, charge_error, detail, cancelled_at, cancelled_by, created_at';

async function attachStayState(db: SupabaseClient, rows: PartnerBookingRow[]): Promise<PartnerBookingRow[]> {
  const ids = [...new Set(rows.flatMap((r) => r.stay_ids ?? []))];
  if (!ids.length) return rows;
  const { data } = await coreDb(db).from('stays').select('id, status').in('id', ids);
  const inHouse = new Set(
    ((data ?? []) as { id: string; status: string }[]).filter((s) => s.status === 'checked_in' || s.status === 'checked_out').map((s) => s.id)
  );
  return rows.map((r) => ({ ...r, checkedIn: (r.stay_ids ?? []).some((id) => inHouse.has(id)) }));
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

export async function cancelPartnerBooking(
  db: SupabaseClient,
  partner: PartnerContext | (PartnerRow & { facility_name?: string }),
  bookingId: string,
  by: 'partner' | 'staff',
  opts: { reason?: string; accountId?: string | null; ip?: string | null; origin: string; refund?: boolean }
): Promise<PartnerBookingRow> {
  const booking = await getPartnerBooking(db, partner.id, bookingId);
  if (!booking) throw new PartnerStoreError('予約が見つかりません。', 404);
  if (booking.status === 'cancelled' || booking.status === 'expired') return booking;
  // 支払待ち（仮押さえ）の取消はいつでもできる。PMS へは何も送っていない。
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
  const { data: cancelled, error } = await db.rpc('rms_partner_cancel_booking', {
    p_partner_booking_id: booking.id,
    p_by: by,
    p_reason: (opts.reason ?? '').slice(0, 500) || null
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
    detail: { bookingCode: booking.booking_code },
    ip: opts.ip ?? null
  });
  // オンライン決済済みは全額返金（取引先の期限内取消は常に。スタッフの取消は画面で選んだとき）
  const paid = (cancelled as { payment_status?: string } | null)?.payment_status === 'paid';
  if (paid && (by === 'partner' || opts.refund !== false)) await refundBooking(db, booking, by === 'partner' ? 'partner_cancel' : 'staff_cancel');
  const after = (await getPartnerBooking(db, partner.id, bookingId)) ?? booking;
  await sendBookingMails(db, partner, after, 'cancelled', opts.origin, booking.account_id).catch(() => false);
  return after;
}

// ---------------------------------------------------------------------------
// 通知メール
// ---------------------------------------------------------------------------

const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付き' : m === '朝食' ? '朝食付き' : m === '素泊' ? '素泊まり' : (m ?? ''));

export function bookingSummaryLines(b: PartnerBookingRow): string[] {
  const g = b.detail.guest ?? {};
  const rooms = b.detail.rooms ?? [];
  const lines = [
    `予約番号: ${b.booking_code}`,
    `宿泊日: ${b.check_in_date}（${b.nights}泊）〜 ${b.check_out_date} チェックアウト`,
    `お部屋: ${b.room_name ?? b.room_code ?? ''} × ${b.room_count}室`,
    `プラン: ${b.plan_name ?? ''}${b.meal_type ? `（${mealLabel(b.meal_type)}）` : ''}`,
    `人数: ${rooms.map((r, i) => `${rooms.length > 1 ? `${i + 1}室目 ` : ''}${r.adults}名`).join(' / ') || `${b.adult_total}名`}`,
    `宿泊者: ${b.guest_name}${b.guest_kana ? `（${b.guest_kana}）` : ''}`,
    `電話: ${b.guest_phone ?? ''}`,
    ...(b.guest_email ? [`メール: ${b.guest_email}`] : []),
    ...(g.address || g.zip_code ? [`住所: ${[g.zip_code, g.address].filter(Boolean).join(' ')}`] : []),
    ...(g.allergies ? [`アレルギー: ${g.allergies}`] : []),
    ...(b.detail.arrival ? [`到着予定: ${b.detail.arrival}`] : []),
    ...(b.detail.options ?? []).map((o) => `${o.label}: ${o.value}`),
    ...(b.detail.notes ? [`備考: ${b.detail.notes}`] : []),
    ...((b.bath_tax_amount ?? 0) > 0
      ? [`宿泊料金: ${yen(b.total_amount)}（税込）`, `入湯税: ${yen(b.bath_tax_amount)}`, `合計: ${yen(chargeAmountOf(b))}`]
      : [`合計: ${yen(b.total_amount)}（税込）`]),
    ...(b.payment_method_name
      ? [
          `お支払: ${b.payment_method_name}${
            b.payment_status === 'paid'
              ? `（お支払い済み ${yen(b.paid_amount ?? chargeAmountOf(b))}）`
              : b.payment_status === 'scheduled'
                ? `（チェックイン日に${b.card_label ? ` ${b.card_label} へ` : ''}請求します）`
                : b.payment_status === 'charge_failed'
                  ? '（カードへの請求ができませんでした）'
                  : b.payment_status === 'refunded'
                ? '（全額返金済み）'
                : b.payment_status === 'refund_failed'
                  ? '（返金できませんでした。宿で対応します）'
                  : ''
          }`
        ]
      : [])
  ];
  return lines;
}

async function sendBookingMails(
  db: SupabaseClient,
  partner: PartnerContext | (PartnerRow & { facility_name?: string; url_token?: string }),
  b: PartnerBookingRow,
  kind: 'new' | 'cancelled',
  origin: string,
  accountId: string | null
): Promise<boolean> {
  const s = partner.booking_settings;
  // 施設名は差出人名と同じもの（core.facilities.name）。partner に施設名が無い呼び出し（Webhook・cron）でも空にしない
  const facilityName = ('facility_name' in partner && partner.facility_name) || (await partnerMailSender(db, partner.facility_id)).fromName;
  const title = kind === 'new' ? 'ご予約を承りました' : 'ご予約を取り消しました';
  const summary = bookingSummaryLines(b);
  const listUrl = `${origin}/p/${partner.url_token}/bookings`;
  let sent = false;

  // 取引先へ（予約したログインIDのメール＋取引先の連絡先メール）
  if (s.notifyPartner) {
    const to = new Set<string>();
    if (partner.contact_email) to.add(partner.contact_email);
    if (accountId) {
      const { data } = await db.from('rms_partner_accounts').select('email').eq('id', accountId).maybeSingle();
      if (data?.email) to.add(String(data.email));
    }
    if (to.size) {
      const text = [`${partner.name} 様`, '', `${facilityName} です。以下の内容で${title}。`, '', ...summary, '', `予約一覧: ${listUrl}`].join('\n');
      const html = `<p>${escapeHtml(partner.name)} 様</p><p>${escapeHtml(facilityName)} です。以下の内容で${title}。</p><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(summary.join('\n'))}</pre><p>予約一覧: <a href="${escapeHtml(listUrl)}">${escapeHtml(listUrl)}</a></p>`;
      const r = await sendPartnerMail(db, partner.facility_id, { to: [...to], subject: `【${facilityName}】${title}（${b.booking_code}）`, html, text });
      sent = sent || r.sent;
    }
  }

  // 宿へ
  if (s.notifyEmails.length) {
    const head = kind === 'new' ? `取引先「${partner.name}」から予約が入りました。` : `取引先予約が取り消されました（${b.cancelled_by === 'staff' ? 'スタッフの操作' : '取引先の操作'}）。`;
    const text = [head, '', ...summary, '', 'PMS には1分ほどで取り込まれます（予約経路: 取引先予約（RMS））。'].join('\n');
    const html = `<p>${escapeHtml(head)}</p><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(summary.join('\n'))}</pre><p style="color:#666;font-size:12px">PMS には1分ほどで取り込まれます（予約経路: 取引先予約（RMS））。</p>`;
    const r = await sendFacilityNotice(db, partner.facility_id, {
      to: s.notifyEmails,
      subject: `【取引先予約${kind === 'new' ? '' : '・取消'}】${partner.name} ${b.check_in_date} ${b.guest_name} 様（${b.booking_code}）`,
      html,
      text
    });
    sent = sent || r.sent;
  }
  return sent;
}

// チェックイン日決済の請求失敗（宿・取引先へ）。
async function sendChargeFailedMails(db: SupabaseClient, partner: AnyPartner, b: PartnerBookingRow, origin: string, reason: string): Promise<boolean> {
  const s = partner.booking_settings;
  const facilityName = ('facility_name' in partner && partner.facility_name) || (await partnerMailSender(db, partner.facility_id)).fromName;
  const summary = bookingSummaryLines(b);
  const listUrl = `${origin}/p/${partner.url_token}/bookings`;
  let sent = false;
  const partnerTo = new Set<string>();
  if (partner.contact_email) partnerTo.add(partner.contact_email);
  if (b.account_id) {
    const { data } = await db.from('rms_partner_accounts').select('email').eq('id', b.account_id).maybeSingle();
    if (data?.email) partnerTo.add(String(data.email));
  }
  if (partnerTo.size) {
    const lead = `${facilityName} です。ご予約（${b.booking_code}）のチェックイン日のお支払いで、ご登録のカードに請求できませんでした（${reason}）。お手数ですが、予約一覧の「カードを登録し直す」から別のカードをご登録ください。`;
    const text = [`${partner.name} 様`, '', lead, '', ...summary, '', `予約一覧: ${listUrl}`].join('\n');
    const html = `<p>${escapeHtml(partner.name)} 様</p><p>${escapeHtml(lead)}</p><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(summary.join('\n'))}</pre><p>予約一覧: <a href="${escapeHtml(listUrl)}">${escapeHtml(listUrl)}</a></p>`;
    const r = await sendPartnerMail(db, partner.facility_id, { to: [...partnerTo], subject: `【${facilityName}】カードへのご請求ができませんでした（${b.booking_code}）`, html, text });
    sent = sent || r.sent;
  }
  if (s.notifyEmails.length) {
    const head = `取引先「${partner.name}」の予約で、チェックイン日のカード請求に失敗しました（${reason}）。取引先にはカードの再登録をお願いするメールを送りました。Book の管理画面（取引先）から再請求するか、現地でのお支払いをご案内ください。`;
    const text = [head, '', ...summary].join('\n');
    const html = `<p>${escapeHtml(head)}</p><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(summary.join('\n'))}</pre>`;
    const r = await sendFacilityNotice(db, partner.facility_id, { to: s.notifyEmails, subject: `【取引先予約・請求失敗】${partner.name} ${b.check_in_date} ${b.guest_name} 様（${b.booking_code}）`, html, text });
    sent = sent || r.sent;
  }
  return sent;
}
