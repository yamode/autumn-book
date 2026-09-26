// 公式サイト予約のオンライン決済（v0.43.0）の純関数。画面（hold）とサーバ（lib/server/direct-payments.ts）で共有する。
//
// 金額の正は DB（book.direct_payment_prepare / direct_payment_refund_due）。ここの計算は画面の表示と、
// サーバが Intent を作る前の突き合わせに使う（同じ式にそろえる）。

import type { PaymentConfig } from '$lib/types';

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

export function directChargeOf(q: { total: number; pointsUsed?: number; bathTax?: number; prepayDiscountRate?: number }): {
  lodging: number;
  bathTax: number;
  discount: number;
  charge: number;
} {
  const discount = prepayDiscountOf(q.total, q.prepayDiscountRate);
  const points = Math.min(Math.max(0, Math.round(q.pointsUsed ?? 0)), q.total - discount);
  const lodging = q.total - points;
  const bathTax = Math.max(0, Math.round(q.bathTax ?? 0));
  return { lodging, bathTax, discount, charge: lodging - discount + bathTax };
}

// 取消後の返金額 = 支払額 − キャンセル料（支払額まで）− 返金済み。0 未満にはしない（SQL の direct_payment_refund_due と同じ）
export function directRefundDueOf(p: { amount: number; fee: number; refunded?: number }): number {
  const fee = Math.min(Math.max(0, p.fee), p.amount);
  return Math.max(0, p.amount - fee - Math.max(0, p.refunded ?? 0));
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
