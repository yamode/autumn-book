// 公式サイト予約のオンライン決済（v0.43.0）の純関数。画面（hold）とサーバ（lib/server/direct-payments.ts）で共有する。
//
// 金額の正は DB（book.direct_payment_prepare / direct_payment_refund_due）。ここの計算は画面の表示と、
// サーバが Intent を作る前の突き合わせに使う（同じ式にそろえる）。

import type { PaymentConfig } from '$lib/types';
import { deductionOf } from '$lib/cancel-admin-fee';

export type PayOption = 'onsite' | 'card' | 'paypay';

// 現地払いの内訳。画面では「現地PayPay決済」「現地カード決済」「現地現金決済」を選んでもらう
// （宿は店頭 PayPay へ誘導したいので PayPay を先頭に置く）。予約は現地払いのまま、内訳は備考で宿へ申し送る
export const ONSITE_METHODS = ['paypay', 'card', 'cash'] as const;
export type OnsiteMethod = (typeof ONSITE_METHODS)[number];
export const ONSITE_METHOD_NOTE: Record<OnsiteMethod, string> = {
  paypay: '【現地PayPay決済希望】',
  card: '【現地カード決済希望】',
  cash: '【現地現金決済希望】'
};

// 請求額 = 宿泊料金 − ポイント − 予約時決済割引 ＋ 入湯税。キャンセル料の基準は宿泊料金（割引前・入湯税を含まない）。
// 割引（autumn-shared 20260926151458）= floor(宿泊料金 × 割引率)。割引率は 0〜0.2（小数3桁）。
// DB と1円でもずれると画面が支払を止めるので、浮動小数を使わず整数（千分率）で計算する。ポイントは割引後の宿泊料金まで。
export function prepayDiscountOf(total: number, rate = 0): number {
  const permille = Math.min(Math.max(Math.round((rate || 0) * 1000), 0), 200);
  return Math.floor((Math.max(0, total) * permille) / 1000);
}

// 早期決済割（lib/early-prepay.ts の prepayDiscountDetail）で求めた割引額は prepayDiscount で渡す（率より優先）。
export function directChargeOf(q: {
  total: number;
  pointsUsed?: number;
  bathTax?: number;
  prepayDiscountRate?: number;
  prepayDiscount?: number;
}): {
  lodging: number;
  bathTax: number;
  discount: number;
  charge: number;
} {
  const discount =
    q.prepayDiscount != null
      ? Math.min(Math.max(0, Math.floor(q.prepayDiscount)), Math.max(0, q.total))
      : prepayDiscountOf(q.total, q.prepayDiscountRate);
  const points = Math.min(Math.max(0, Math.round(q.pointsUsed ?? 0)), q.total - discount);
  const lodging = q.total - points;
  const bathTax = Math.max(0, Math.round(q.bathTax ?? 0));
  return { lodging, bathTax, discount, charge: lodging - discount + bathTax };
}

// 取消後の返金額 = 支払額 − 差し引く額 − 返金済み。0 未満にはしない（SQL の direct_payment_refund_due と同じ）
// 予約時決済の割引額は返金しない（2026-09-27 ユーザー決定・autumn-shared 20260926221912）。
// 事務手数料（支払額 × 予約時の率）も返金しない（2026-10-07 ユーザー決定・autumn-shared 20261007010002・lib/cancel-admin-fee.ts）:
//   差し引く額 = max(規定のキャンセル料〔支払額まで〕, 割引額, 事務手数料)〔割引額・事務手数料は入湯税を除いた支払額まで＝入湯税は必ず返す〕。
//   キャンセル料を免除した取消（waived・施設都合）は割引額も返す。事務手数料は adminFeeWaived（スタッフが取消フォームで選ぶ）のときだけ返す。
//   率の無い導入前の予約（adminFeePercent = null）は事務手数料なし。
export function directRefundDueOf(p: {
  amount: number;
  fee: number;
  refunded?: number;
  prepayDiscount?: number;
  waived?: boolean;
  bathTax?: number;
  adminFeePercent?: number | null;
  adminFeeWaived?: boolean;
}): number {
  const d = deductionOf({
    paid: p.amount,
    bathTax: p.bathTax,
    fee: p.fee,
    // 免除のときは割引額を差し引かない（キャンセル料は渡された額のまま＝DB と同じ）
    discount: p.waived ? 0 : p.prepayDiscount,
    adminFeePercent: p.adminFeePercent,
    adminFeeWaived: p.adminFeeWaived
  });
  return Math.max(0, p.amount - d.kept - Math.max(0, p.refunded ?? 0));
}

// プランの支払設定から、画面に出す支払方法を決める。
//   - onlineReady: オンライン決済（Stripe の鍵・DB の migration・service_role）がそろっているか
//   - live: 実データ（DATA_SOURCE=supabase）。デモは従来どおり（カード・PayPay はデモ決済画面へ）
// 実データでオンライン決済が使えないときは事前決済を出さない。事前決済しか無いプラン（prepayment）は
// 予約を止めないよう現地払いで受ける（fallback=true。画面で注記する）。
// deposit（内金）は既存どおり「カード（全額の事前決済）か現地払いを選べる」扱い。
export function payOptionsFor(
  payment: Pick<PaymentConfig, 'onsite' | 'prepay' | 'prepayMethods'>,
  opts: { live: boolean; onlineReady: boolean }
): { options: PayOption[]; fallback: boolean } {
  const out: PayOption[] = [];
  if (payment.prepay) {
    for (const m of payment.prepayMethods) {
      if (!opts.live) out.push(m);
      else if (m === 'card' && opts.onlineReady) out.push('card');
    }
  }
  if (payment.onsite) out.push('onsite');
  if (out.length === 0) return { options: ['onsite'], fallback: true };
  return { options: out, fallback: false };
}
