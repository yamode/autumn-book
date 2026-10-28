// 取引先予約の銀行振込の事前支払（前受金）の状態・入金確認・返金（サーバ・画面共通の純関数）。
//
// 設計: docs/partner-prepayment.md §4（2026-10-28 ユーザー指示・フェーズ4）。
//   - 対象は deposit_bank（一部・銀行振込）と advance_bank（全額・銀行振込）。予約は即確定（status='confirmed'）し、
//     台帳の payment_status は unpaid（入金待ち）。宿が管理画面で「入金済みにする」と paid（rms_partner_mark_advance_paid）。
//   - 期限（advance_due_date・JST の日付）を過ぎても未入金なら「期限超過」と出すだけ。自動取消はしない。
//   - 取消: 入金待ちならキャンセル料は月次請求書へ（デポジットと違い受け取ったお金が無い）。入金済みならデポジットと同じく
//     キャンセル料に充当し、差額は宿が手で銀行振込で返す（Stripe では返金できない）。返金したら管理画面で「返金済みにする」。
//   - payment_status='unpaid' は、オンライン決済では「支払待ち（仮押さえ・status='pending_payment'）」の意味だが、
//     銀行振込の前受金では「確定済み・入金待ち」。見分けるときは payment_option（isAdvanceBankOption）で分ける。
import { ADVANCE_BANK_OPTION, DEPOSIT_BANK_OPTION, isAdvanceBankOption } from '$lib/partner-booking';

export type AdvanceSource = {
  status: string;
  payment_option: string | null | undefined;
  payment_status: string;
  advance_amount?: number | null;
  advance_due_date?: string | null;
  paid_amount?: number | null;
  paid_at?: string | null;
  refund_amount?: number | null;
};

const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
// 入金日（paid_at・timestamptz）の JST の日付
export const jstDateOf = (iso: string | null | undefined) =>
  iso ? new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) : '';

/** 銀行振込の前受金の予約か（支払方法が deposit_bank / advance_bank で、前受金の額が台帳にある） */
export const isAdvanceBooking = (b: Pick<AdvanceSource, 'payment_option' | 'advance_amount'>) =>
  isAdvanceBankOption(b.payment_option) && (b.advance_amount ?? 0) > 0;

/** 全額の前受金（advance_bank）か */
export const isFullAdvance = (b: Pick<AdvanceSource, 'payment_option'>) => b.payment_option === ADVANCE_BANK_OPTION;

/** 一部の前受金（deposit_bank）か */
export const isPartialBankAdvance = (b: Pick<AdvanceSource, 'payment_option'>) => b.payment_option === DEPOSIT_BANK_OPTION;

/** 前受金が入金済みか（入金確認の後。取消後に返金した予約も「入金はあった」ので true） */
export const isAdvancePaid = (b: Pick<AdvanceSource, 'payment_option' | 'advance_amount' | 'payment_status'>) =>
  isAdvanceBooking(b) && (b.payment_status === 'paid' || b.payment_status === 'refunded');

/** 入金待ち（確定済み・前受金の予約・入金確認前）か */
export const isAdvanceWaiting = (b: AdvanceSource) =>
  b.status === 'confirmed' && isAdvanceBooking(b) && b.payment_status !== 'paid' && b.payment_status !== 'refunded';

/** 期限超過（確定済み・入金確認前・振込期限が今日〔JST〕より前）か。自動取消はしない（表示だけ） */
export const isAdvanceOverdue = (b: AdvanceSource, today: string) => isAdvanceWaiting(b) && !!b.advance_due_date && b.advance_due_date < today;

export type AdvanceBadge = { tone: 'waiting' | 'overdue' | 'paid' | 'refund_due'; label: string };

/**
 * 一覧・詳細に出す前受金の印（前受金の予約でなければ null）。
 *   入金待ち … 「前受金 入金待ち（期限 M/D）」
 *   期限超過 … 「前受金 期限超過（期限 M/D）」
 *   入金済み … 「前受金 入金済み（M/D・○円）」（取消前）
 *   取消後の返金待ち（refundDue > 0）… 「前受金 返金待ち（○円）」
 */
export function advanceBadgeOf(b: AdvanceSource, today: string, refundDue = 0): AdvanceBadge | null {
  if (!isAdvanceBooking(b)) return null;
  const due = b.advance_due_date ?? '';
  if (isAdvanceWaiting(b)) {
    return isAdvanceOverdue(b, today)
      ? { tone: 'overdue', label: `前受金 期限超過（期限 ${md(due)}）` }
      : { tone: 'waiting', label: `前受金 入金待ち${due ? `（期限 ${md(due)}）` : ''}` };
  }
  if (b.status === 'cancelled') {
    if (b.payment_status === 'paid' && refundDue > 0) return { tone: 'refund_due', label: `前受金 返金待ち（${yen(refundDue)}）` };
    return null;
  }
  if (b.payment_status === 'paid') return { tone: 'paid', label: advancePaidLabel(b) };
  return null;
}

/** 「前受金 入金済み（M/D・○円）」 */
export function advancePaidLabel(b: Pick<AdvanceSource, 'paid_at' | 'paid_amount' | 'advance_amount'>): string {
  const day = jstDateOf(b.paid_at);
  const amount = b.paid_amount ?? b.advance_amount ?? 0;
  return `前受金 入金済み（${[day ? md(day) : '', amount ? yen(amount) : ''].filter(Boolean).join('・')}）`;
}

// ---- 入金確認・返金のフォーム（管理画面） ----

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s: string) => DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * 「入金済みにする」の入力（金額〔空なら前受金の額〕・入金日〔空なら今日〕）を確かめる。
 * 金額は 1円以上・ご利用額（宿泊料金＋入湯税）以下の整数。入金日は今日（JST）以前の実在する日付。
 * DB 関数 rms_partner_mark_advance_paid の検証（invalid_amount / invalid_paid_on）と同じ範囲。
 */
export function parseAdvancePaidInput(
  raw: { amount: unknown; paidOn: unknown },
  ctx: { advanceAmount: number; maxAmount: number; today: string }
): { ok: true; amount: number; paidOn: string } | { ok: false; message: string } {
  const a = String(raw.amount ?? '').replace(/[,，円\s]/g, '');
  const amount = a === '' ? ctx.advanceAmount : Number(a);
  if (!Number.isInteger(amount) || amount < 1 || amount > ctx.maxAmount) {
    return { ok: false, message: `入金額は 1円〜${yen(ctx.maxAmount)}（ご利用額）の整数で入力してください。` };
  }
  const d = String(raw.paidOn ?? '').trim();
  const paidOn = d === '' ? ctx.today : d;
  if (!isRealDate(paidOn)) return { ok: false, message: '入金日を正しく入力してください（例: 2026-11-01）。' };
  if (paidOn > ctx.today) return { ok: false, message: '入金日に未来の日付は指定できません。' };
  return { ok: true, amount, paidOn };
}

/** 入金確認 RPC の結果・例外 → 管理画面の文言 */
export function advancePaidRpcMessage(result: string | null, errorMessage?: string | null): { ok: boolean; message: string } {
  if (errorMessage) {
    if (errorMessage.includes('not_advance_booking')) return { ok: false, message: '銀行振込の前受金の予約ではないため、入金済みにできません。' };
    if (errorMessage.includes('invalid_amount')) return { ok: false, message: '入金額が正しくありません（1円以上・ご利用額以下）。' };
    if (errorMessage.includes('invalid_paid_on')) return { ok: false, message: '入金日に未来の日付は指定できません。' };
    if (errorMessage.includes('partner_booking_not_found')) return { ok: false, message: '取引先予約が見つかりません。' };
    return { ok: false, message: '入金済みにできませんでした。時間をおいてお試しください。' };
  }
  if (result === 'already') return { ok: false, message: 'この前受金はすでに入金済みになっています。' };
  if (result === 'not_confirmed') return { ok: false, message: '確定済みの予約ではない（取消済みなど）ため、入金済みにできません。' };
  if (result === 'paid') return { ok: true, message: '' };
  return { ok: false, message: '入金済みにできませんでした（結果が不明です）。画面を読み込み直して確かめてください。' };
}

/**
 * 「返金済みにする」の入力（返金額〔空なら返金すべき額〕・返金日〔空なら今日〕）を確かめる。
 * 返金額は 0円〜入金額の整数（0 は「返金しないことにした」）。返金日は今日（JST）以前の実在する日付。
 */
export function parseAdvanceRefundInput(
  raw: { amount: unknown; refundedOn: unknown },
  ctx: { refundDue: number; paid: number; today: string }
): { ok: true; amount: number; refundedOn: string } | { ok: false; message: string } {
  const a = String(raw.amount ?? '').replace(/[,，円\s]/g, '');
  const amount = a === '' ? ctx.refundDue : Number(a);
  if (!Number.isInteger(amount) || amount < 0 || amount > ctx.paid) {
    return { ok: false, message: `返金額は 0円〜${yen(ctx.paid)}（入金額）の整数で入力してください。` };
  }
  const d = String(raw.refundedOn ?? '').trim();
  const refundedOn = d === '' ? ctx.today : d;
  if (!isRealDate(refundedOn)) return { ok: false, message: '返金日を正しく入力してください（例: 2026-11-01）。' };
  if (refundedOn > ctx.today) return { ok: false, message: '返金日に未来の日付は指定できません。' };
  return { ok: true, amount, refundedOn };
}

/**
 * 取消済み・入金済みの前受金の返金の案内（返金がまだ要らない・前受金でなければ null）。
 * paid … 入金額 / kept … キャンセル料に充当する額 / refund … 宿が銀行振込で返す額。kept・refund は partnerRefundOf（取消の精算）の値を渡す。
 */
export function advanceRefundNotice(paid: number, kept: number, refund: number): string {
  if (refund <= 0) return `前受金 ${yen(paid)} 入金済み。キャンセル料 ${yen(kept)} に充当するため、返金はありません。`;
  return kept > 0
    ? `前受金 ${yen(paid)} 入金済み。キャンセル料 ${yen(kept)} を差し引き、${yen(refund)} を銀行振込でお返しください。`
    : `前受金 ${yen(paid)} 入金済み。全額 ${yen(refund)} を銀行振込でお返しください。`;
}

/** 月次請求書の行の注記（入金待ちのまま月次請求の対象になった前受金） */
export const ADVANCE_UNPAID_INVOICE_NOTE = '前受金 未入金のため全額ご請求';

/**
 * 入金待ちのままチェックアウトした（月次請求書で全額を請求する）前受金か。
 * このとき前受金のご請求書が有効なままだと二重請求になるので、管理画面で「取り消してください」と出す（自動では取り消さない）。
 * billedToPartner は請求書と同じ isPartnerBilledBooking の結果。
 */
export const isAdvanceUnpaidAtCheckout = (b: AdvanceSource & { check_out_date: string }, today: string, billedToPartner: boolean) =>
  billedToPartner && isAdvanceWaiting(b) && b.check_out_date <= today;
