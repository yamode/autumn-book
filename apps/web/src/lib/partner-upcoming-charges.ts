// 「今後の請求予定」（管理画面 /admin/partners/charges）と、チェックアウト日決済の SetupIntent の metadata の純関数。
//
// 対象: 取引先予約の「オンライン決済（チェックアウト日）」（payment_option='online_checkin'）だけ。
//   予約時に SetupIntent でカードを登録し、チェックアウト日に cron（chargeDueBookings）が off-session で請求する。
//   公式サイトの予約は予約時に請求が済む（PaymentIntent・デポジットの残額は請求書／現地）ので、後日のカード請求は無い（2026-10-10 調査）。
// 区分:
//   scheduled      … 請求予定（status=confirmed・payment_status=scheduled）。請求日＝チェックアウト日
//   charge_failed  … 請求失敗（status=confirmed・payment_status=charge_failed）。期間に関係なく先頭に出す（要対応）
//   cancel_fee     … 取消済みで、キャンセル料をカードへ請求する予定のまま（cancel_fee_settlement='card'・未請求）。
//                    通常は取消と同時に請求するので残らない。残っていれば取消時の請求が途中で止まった（要確認）
//   cancelled      … 最近取り消したもの（請求なし・切替で表示）。取消は payment_status を scheduled のまま残すので status で見分ける
// DB・Stripe に触らないので単体テストできる（partner-upcoming-charges.test.ts）。
import { chargeAmountOf } from '$lib/partner-booking';

export type UpcomingKind = 'scheduled' | 'charge_failed' | 'cancel_fee' | 'cancelled';

/** 台帳（public.rms_partner_bookings）から使う列 */
export type UpcomingSource = {
  status: string;
  payment_option: string | null;
  payment_status: string;
  check_out_date: string;
  total_amount: number;
  bath_tax_amount?: number | null;
  prepay_discount_amount?: number | null;
  cancelled_at?: string | null;
  cancel_fee?: number | null;
  cancel_fee_settlement?: string | null;
  cancel_fee_status?: string | null;
};

export const CHECKOUT_CHARGE_OPTION = 'online_checkin';

/** 予約の区分（一覧に出さないものは null） */
export function upcomingKindOf(b: UpcomingSource): UpcomingKind | null {
  if (b.payment_option !== CHECKOUT_CHARGE_OPTION) return null;
  if (b.status === 'confirmed') {
    if (b.payment_status === 'scheduled') return 'scheduled';
    if (b.payment_status === 'charge_failed') return 'charge_failed';
    return null;
  }
  if (b.status === 'cancelled') {
    if (b.cancel_fee_settlement === 'card' && (b.cancel_fee ?? 0) > 0 && !b.cancel_fee_status) return 'cancel_fee';
    return 'cancelled';
  }
  return null;
}

/** 区分ごとの請求額（請求予定・失敗＝宿泊料金＋入湯税−割引、キャンセル料＝キャンセル料、取消＝0） */
export function upcomingAmountOf(b: UpcomingSource, kind: UpcomingKind): number {
  if (kind === 'scheduled' || kind === 'charge_failed') return chargeAmountOf(b);
  if (kind === 'cancel_fee') return Math.max(0, b.cancel_fee ?? 0);
  return 0;
}

export const UPCOMING_KIND_LABEL: Record<UpcomingKind, string> = {
  scheduled: '請求予定',
  charge_failed: '請求失敗',
  cancel_fee: 'キャンセル料（未請求）',
  cancelled: '取消済み（請求なし）'
};

// ---- 期間 ----

export type ChargeRangePreset = 'all' | 'this_month' | 'next_month' | 'custom';
export type ChargeRange = { preset: ChargeRangePreset; from: string | null; to: string | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string | null | undefined): string | null => {
  if (!s || !DATE_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
};

/** 'YYYY-MM-DD' の月の初日・末日（months 月ずらす） */
export function monthBounds(today: string, months = 0): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(y, m + months, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/**
 * 画面の絞り込み（?range=all|this_month|next_month|custom&from=&to=）から期間を決める。from / to は両端を含む。
 * 指定（custom）で日付が正しくない・前後が逆なら入れ替え／片側だけ使う。何も無ければ all。
 */
export function parseChargeRange(params: { range?: string | null; from?: string | null; to?: string | null }, today: string): ChargeRange {
  const preset = params.range;
  if (preset === 'this_month') return { preset, ...monthBounds(today, 0) };
  if (preset === 'next_month') return { preset, ...monthBounds(today, 1) };
  if (preset === 'custom') {
    let from = validDate(params.from);
    let to = validDate(params.to);
    if (from && to && from > to) [from, to] = [to, from];
    if (from || to) return { preset, from, to };
  }
  return { preset: 'all', from: null, to: null };
}

export const inChargeRange = (date: string, r: ChargeRange) => (!r.from || date >= r.from) && (!r.to || date <= r.to);

// ---- CSV ----

export type UpcomingCsvRow = {
  kind: UpcomingKind;
  chargeOn: string;
  bookingCode: string;
  partnerName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guestName: string;
  amount: number;
  cardLabel: string | null;
  cancelledAt: string | null;
  error: string | null;
};

const csvCell = (v: string | number | null | undefined) => {
  if (v == null) return '';
  // 文字列の先頭が = + - @ だと表計算ソフトが式として読むので、先頭に ' を付ける（数値はそのまま）
  const s = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 取消日時（ISO）を JST の 'YYYY-MM-DD HH:MM' に */
export function jstDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
}

export function upcomingChargesCsv(rows: UpcomingCsvRow[]): string {
  const head = ['区分', '請求予定日', '予約番号', '取引先', 'チェックイン', 'チェックアウト', '泊数', '宿泊者', '請求額', 'カード', '取消日時', 'エラー'];
  const body = rows.map((r) => [
    UPCOMING_KIND_LABEL[r.kind],
    r.chargeOn,
    r.bookingCode,
    r.partnerName,
    r.checkIn,
    r.checkOut,
    r.nights,
    r.guestName,
    r.amount,
    r.cardLabel,
    jstDateTime(r.cancelledAt),
    r.error
  ]);
  return '﻿' + [head, ...body].map((cols) => cols.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---- Stripe の SetupIntent の metadata ----
// Stripe の管理画面で予約番号を検索 → SetupIntent を開けば、請求予定日・金額・予約の状態が分かるようにする。
// 上限: キー 40 文字・値 500 文字・50 個（既存の app / purpose / flow / partner_booking_id / booking_code / partner_id /
// facility / consent_text に、ここの最大 8 個を足しても 16 個）。値に '' を送ると Stripe はそのキーを消す。

export type SetupIntentChargeEvent =
  | { type: 'created' | 'card_saved'; status: string; cardLabel?: string | null }
  | { type: 'cancelled'; cancelledAt: string | null; cancelFee?: number | null; cancelFeeSettlement?: string | null; cancelFeeStatus?: string | null }
  | { type: 'charged'; chargedAt: string; paymentIntent: string | null }
  | { type: 'charge_failed'; failedAt: string; error: string; paymentIntent?: string | null }
  | { type: 'charged_after_cancel'; chargedAt: string; paymentIntent: string | null };

const clip = (s: string) => s.slice(0, 500);

/** 請求予定日・請求額（作成時・カード登録時に付ける） */
export function chargePlanMetadata(b: Pick<UpcomingSource, 'check_out_date' | 'total_amount' | 'bath_tax_amount' | 'prepay_discount_amount'>): Record<string, string> {
  return { charge_on: b.check_out_date, charge_amount: String(Math.max(0, Math.round(chargeAmountOf(b)))) };
}

/** 予約の出来事に応じて SetupIntent に書く metadata（請求予定日・請求額は chargePlanMetadata と合わせて使う） */
export function setupIntentEventMetadata(e: SetupIntentChargeEvent): Record<string, string> {
  switch (e.type) {
    case 'created':
    case 'card_saved': {
      const m: Record<string, string> = { booking_status: e.status };
      if (e.type === 'card_saved') {
        // カードの登録し直し（請求失敗の後など）では前の失敗・取消の記録を消す
        m.charge_error = '';
        if (e.cardLabel) m.card = clip(e.cardLabel);
      }
      return m;
    }
    case 'cancelled': {
      const m: Record<string, string> = { booking_status: 'cancelled', cancelled_at: e.cancelledAt ?? new Date().toISOString() };
      const fee = Math.max(0, Math.round(e.cancelFee ?? 0));
      if (fee > 0) {
        m.cancel_fee = String(fee);
        // 精算先（card＝登録カード・invoice＝月末の請求書・refund＝予約時決済から差し引き）と、カードへの請求の結果（charged / charge_failed）
        if (e.cancelFeeSettlement) m.cancel_fee_settlement = e.cancelFeeSettlement;
        if (e.cancelFeeStatus) m.cancel_fee_status = e.cancelFeeStatus;
      }
      return m;
    }
    case 'charged':
      return { booking_status: 'charged', charged_at: e.chargedAt, ...(e.paymentIntent ? { payment_intent: e.paymentIntent } : {}), charge_error: '' };
    case 'charge_failed':
      return { booking_status: 'charge_failed', charge_failed_at: e.failedAt, charge_error: clip(e.error), ...(e.paymentIntent ? { payment_intent: e.paymentIntent } : {}) };
    case 'charged_after_cancel':
      // 請求中に取り消された（請求後に返金する）
      return { booking_status: 'cancelled', charged_at: e.chargedAt, ...(e.paymentIntent ? { payment_intent: e.paymentIntent } : {}), refunded: 'charged_after_cancel' };
  }
}
