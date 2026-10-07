// 予約時決済の事務手数料（取消時に返金しない率）（2026-10-07 ユーザー決定・autumn-shared 20261007010002）。
// 画面・サーバ（公式サイト・取引先予約）共通の純関数。
//
// - 予約時にオンライン決済で払った予約を取り消したとき、施設で決めた率（%）は、キャンセル料の期間に関係なく
//   「事務手数料」として返金しない。返金しない額は キャンセル料・予約時決済の割引額・事務手数料 の **いちばん大きい方**（足し合わせない）。
// - 率は施設ごとに 1 つ（book.payment_settings.cancel_admin_fee_percent）。既定 5%。
//   Stripe の決済手数料 3.6% 以下は保存できない。0%（事務手数料なし）も保存できない（下限の趣旨と同じ。DB の check も同じ）。
//   取らない取消は、スタッフが取消フォームで個別に免除する。
// - 予約ごとに率を残す（予約前に見せた率で合意をとるため）。率が残っていない導入前の予約は事務手数料なし。
// - 事務手数料 = floor(支払額 × 率)。差し引く上限は「入湯税を除いた支払額」（入湯税は必ず返す・割引額と同じ）。
//   DB（book.direct_payment_refund_due）と同じ式。率は小数1桁なので千分率の整数で計算する（浮動小数を使わない）。

/** Stripe の決済手数料（%）。これ以下の率は保存できない */
export const STRIPE_FEE_PERCENT = 3.6;
export const ADMIN_FEE_MAX_PERCENT = 20;
export const DEFAULT_ADMIN_FEE_PERCENT = 5;

/** 保存できる率か。だめなら理由（日本語）、よければ null */
export function adminFeePercentError(v: unknown): string | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (v == null || String(v).trim() === '' || !Number.isFinite(n)) return '事務手数料の率を数字で入力してください。';
  const r = Math.round(n * 10) / 10;
  if (r <= STRIPE_FEE_PERCENT)
    return `事務手数料の率は、決済手数料（${STRIPE_FEE_PERCENT}%）より大きくしてください（${STRIPE_FEE_PERCENT}% 以下は保存できません）。`;
  if (r > ADMIN_FEE_MAX_PERCENT) return `事務手数料の率は ${ADMIN_FEE_MAX_PERCENT}% 以下にしてください。`;
  return null;
}

/** 率を小数1桁に丸める（保存・表示用） */
export const roundAdminFeePercent = (v: number) => Math.round(v * 10) / 10;

/** 表示用「5%」「4.5%」 */
export const adminFeePercentLabel = (p: number) => `${roundAdminFeePercent(p)}%`;

/** 読み込んだ値を率に（不正・範囲外は既定の 5%） */
export function normalizeAdminFeePercent(v: unknown): number {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) && adminFeePercentError(n) == null ? roundAdminFeePercent(n) : DEFAULT_ADMIN_FEE_PERCENT;
}

/** 事務手数料の額 = floor(基準額 × 率)。率は千分率の整数で（DB と同じ） */
export function adminFeeOf(base: number, percent: number | null | undefined): number {
  if (percent == null || !Number.isFinite(percent) || percent <= 0) return 0;
  const permille = Math.round(percent * 10);
  return Math.floor((Math.max(0, Math.round(base)) * permille) / 1000);
}

/** 予約に残した率と免除（取引先予約は rms_partner_bookings.cancel_policy の admin_fee_percent / admin_fee_waived） */
export type AdminFeeTerms = { percent: number | null; waived: boolean };

export function readAdminFeeTerms(cancelPolicy: unknown): AdminFeeTerms {
  const o = cancelPolicy && typeof cancelPolicy === 'object' && !Array.isArray(cancelPolicy) ? (cancelPolicy as Record<string, unknown>) : {};
  const raw = o.admin_fee_percent;
  const n = Number(raw);
  const percent = raw == null || raw === '' || !Number.isFinite(n) || n <= 0 ? null : roundAdminFeePercent(n);
  return { percent, waived: o.admin_fee_waived === true };
}

/** 差し引く額の理由 */
export type KeptReason = 'cancel_fee' | 'prepay_discount' | 'admin_fee' | 'none';

export type Deduction = {
  /** 差し引く額（＝返金しない額） */
  kept: number;
  reason: KeptReason;
  /** 比べた各額（上限をかけた後） */
  cancelFee: number;
  discount: number;
  adminFee: number;
};

/**
 * 予約時決済（全額）の取消で差し引く額 = max(キャンセル料〔支払額まで〕, 割引額, 事務手数料)。
 * 割引額・事務手数料は「入湯税を除いた支払額」まで。
 *   waived: キャンセル料の免除（割引額も差し引かない＝従来どおり）
 *   adminFeeWaived: 事務手数料も免除（スタッフの取消フォームで選ぶ。既定は差し引く）
 * 同額のときの理由はキャンセル料 → 割引 → 事務手数料の順（DB と同じ）。
 */
export function deductionOf(p: {
  paid: number;
  bathTax?: number;
  fee: number;
  discount?: number;
  adminFeePercent?: number | null;
  waived?: boolean;
  adminFeeWaived?: boolean;
}): Deduction {
  const paid = Math.max(0, p.paid);
  const cap = Math.max(0, paid - Math.max(0, p.bathTax ?? 0));
  const cancelFee = Math.min(Math.max(0, p.waived ? 0 : p.fee), paid);
  const discount = p.waived ? 0 : Math.min(Math.max(0, p.discount ?? 0), cap);
  const adminFee = p.adminFeeWaived ? 0 : Math.min(adminFeeOf(paid, p.adminFeePercent), cap);
  let kept = cancelFee;
  let reason: KeptReason = 'cancel_fee';
  if (discount > kept) {
    kept = discount;
    reason = 'prepay_discount';
  }
  if (adminFee > kept) {
    kept = adminFee;
    reason = 'admin_fee';
  }
  if (kept <= 0) reason = 'none';
  return { kept, reason, cancelFee, discount, adminFee };
}

/** 差し引く額の内訳の言葉（「キャンセル料」「事務手数料（5%）」など） */
export function keptReasonLabel(reason: KeptReason, adminFeePercent?: number | null): string {
  switch (reason) {
    case 'cancel_fee':
      return 'キャンセル料';
    case 'prepay_discount':
      return '予約時決済割引の分';
    case 'admin_fee':
      return adminFeePercent ? `事務手数料（${adminFeePercentLabel(adminFeePercent)}）` : '事務手数料';
    default:
      return '';
  }
}

/**
 * 予約前の案内（キャンセルポリシー・特商法・予約入力で予約時決済を選んだとき）。
 *   partner: 取引先向け（事業者）
 *   consumer: 一般のお客様向け（消費者契約法の「平均的な損害」に配慮し、理由＝決済手数料等の実費を明示）
 */
export function adminFeeNotice(percent: number, audience: 'partner' | 'consumer' = 'partner'): string {
  const p = adminFeePercentLabel(percent);
  if (audience === 'consumer') {
    return `予約時にオンライン決済でお支払いのご予約を取り消した場合、キャンセル料のかからない期間でも、お支払額の ${p} は事務手数料（カード決済手数料・返金の事務にかかる費用）としてご返金いたしません（キャンセル料がこれを上回る場合はキャンセル料をいただきます。両方はいただきません）。`;
  }
  return `予約時決済のご予約を取り消した場合、ご請求額の ${p} は事務手数料としてご返金いたしません（キャンセル料がこれを上回る場合はキャンセル料）。`;
}
