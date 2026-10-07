// 取引先予約のキャンセル料（2026-10-06 指示・サーバ・画面共通の純関数）。
//
// - 基準額: 税込の予約金額から入湯税を引いた額。予約時決済の割引などが入っていても、割引前の金額で計算する
//   （＝台帳の total_amount）。料率を掛けて円未満は切り捨て。
// - 料率: 予約時点の規定（rms_partner_bookings.cancel_policy）。無い予約（導入前）は今のプランの規定
//   （プラン個別 → 施設の既定。取引先ページのキャンセルポリシーと同じ）。
// - 取消の日: 宿泊日の何日前か（JST の暦日）。規定は「N日前から X%」なので、N 以下で最も小さい段を当てる。
// - 精算: 支払方法で決まる（settlementOf）。
//     請求書払い・自由入力の支払方法 … 月末の請求書（チェックアウト予定日の月）に不課税で載せる
//     予約時決済（支払済み） … 支払額から差し引いて返金。差し引く額は直販と同じく max(キャンセル料, 割引額, 事務手数料)
//       事務手数料（2026-10-07・lib/cancel-admin-fee.ts）= 予約時に残した率（cancel_policy.admin_fee_percent）× 支払額。
//       キャンセル料の期間に関係なく返金しない。足し合わせず大きい方。率の無い導入前の予約は 0
//     チェックアウト日決済（カード登録のみ・未請求） … 取消時に登録カードへ請求（失敗したら請求書へ回す）
//     デポジット（支払済み・Phase 3b） … デポジットをキャンセル料に充当し、差額を返金。キャンセル料がデポジットを超えた
//       不足分は、残額の精算先にかかわらず月末の請求書へ（不課税）。免除は全額返金
//       （2026-10-07 変更: 旧 N3「現地なら不足分は請求しない」を廃止。現地精算の取引先でも不足分は請求書で請求する）
//       事務手数料（2026-10-07）もデポジットから差し引く: 充当＝min(max(キャンセル料, デポジット × 率), デポジット)。
//       デポジットもカードで受けたお金（決済手数料がかかる）なので、全額の予約時決済と同じ「大きい方」の規則にそろえた。
//       不足分（請求書へ回す額）はキャンセル料だけから出す（事務手数料はデポジット以下なので不足は生まない）
//     キャンセル料の免除（waived）は事務手数料の免除ではない。事務手数料も免除するかは cancel_policy.admin_fee_waived（スタッフが選ぶ）
// - 請求書上は「逸失利益に対する損害賠償金」として不課税で計上する（消費税の対象外）。
import { normalizeRules, type Rule } from '$lib/partner-plan-terms';
import { isDepositPaymentOption } from '$lib/partner-booking';
import { adminFeeOf, deductionOf, keptReasonLabel, readAdminFeeTerms, type KeptReason } from '$lib/cancel-admin-fee';

export type CancelPolicy = { rules: Rule[]; noShowPercent: number | null };

const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** 保存した規定（{rules, no_show_rate_percent}）を読む。段が無ければ null。 */
export function readCancelPolicy(raw: unknown): CancelPolicy | null {
  const o = obj(raw);
  const rules = normalizeRules(o.rules ?? raw);
  const ns = o.no_show_rate_percent;
  const noShowPercent = ns == null || ns === '' || !Number.isFinite(Number(ns)) ? null : Math.max(0, Math.round(Number(ns)));
  return rules.length || noShowPercent != null ? { rules, noShowPercent } : null;
}

/** 台帳に保存する形 */
export const storeCancelPolicy = (p: CancelPolicy) => ({ rules: p.rules, no_show_rate_percent: p.noShowPercent });

/** rms_partner_plan_terms の結果から、プランに当たる規定（プラン個別 → 施設の既定）。 */
export function planCancelPolicy(raw: unknown, planCode: string | null, planName: string | null): CancelPolicy | null {
  const data = obj(raw);
  const plan = arr(data.plans)
    .map(obj)
    .find((p) => str(p.plan_code) === (planCode ?? '') && str(p.plan_label) === (planName ?? ''));
  const own = normalizeRules(plan?.cancellation_policy);
  if (own.length) return { rules: own, noShowPercent: null };
  const def = obj(data.default_cancellation);
  return readCancelPolicy({ rules: def.rules, no_show_rate_percent: def.no_show_rate_percent });
}

const JST_OFFSET_MS = 9 * 3600 * 1000;
const jstDate = (d: Date) => new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);

/** 宿泊日の何日前か（JST の暦日。宿泊日当日以降は 0） */
export function daysBeforeStay(checkIn: string, now = new Date()): number {
  const diff = Math.round((Date.parse(`${checkIn}T00:00:00Z`) - Date.parse(`${jstDate(now)}T00:00:00Z`)) / 86400000);
  return Math.max(0, diff);
}

export const daysLabel = (d: number) => (d === 0 ? '当日' : d === 1 ? '前日' : `${d}日前`);

/** その日数に当たる料率（%）。当たる段が無ければ 0。 */
export function rateFor(policy: CancelPolicy | null, daysBefore: number): number {
  if (!policy) return 0;
  const hit = [...policy.rules].sort((a, b) => a.days_before - b.days_before).find((r) => daysBefore <= r.days_before);
  return hit?.rate_percent ?? 0;
}

/** 不泊の料率。規定に無ければ当日の料率。 */
export const noShowRateFor = (policy: CancelPolicy | null) => policy?.noShowPercent ?? rateFor(policy, 0);

/** キャンセル料の基準額（割引前・入湯税を除く税込の予約金額） */
export const cancelFeeBaseOf = (b: { total_amount: number }) => Math.max(0, Math.round(b.total_amount));

export const feeOf = (base: number, ratePercent: number) => Math.floor((Math.max(0, base) * Math.max(0, ratePercent)) / 100);

export type CancelFeeQuote = {
  base: number;
  daysBefore: number;
  rate: number; // %
  fee: number;
  basis: string; // 「2日前」「不泊」など
};

export function quoteCancelFee(
  b: { total_amount: number; check_in_date: string },
  policy: CancelPolicy | null,
  opts: { now?: Date; noShow?: boolean } = {}
): CancelFeeQuote {
  const base = cancelFeeBaseOf(b);
  const daysBefore = daysBeforeStay(b.check_in_date, opts.now);
  const rate = opts.noShow ? noShowRateFor(policy) : rateFor(policy, daysBefore);
  return { base, daysBefore, rate, fee: feeOf(base, rate), basis: opts.noShow ? '不泊' : daysLabel(daysBefore) };
}

/** 規定の表（取消確認欄に出す）。日数の多い順・0% の段（無料）を先頭に足す・今の段に印。 */
export function cancelPolicyTable(policy: CancelPolicy | null, daysBefore: number): { label: string; rate: number; current: boolean }[] {
  if (!policy) return [];
  const rules = [...policy.rules].filter((r) => r.rate_percent > 0).sort((a, b) => b.days_before - a.days_before);
  if (!rules.length) return [];
  const current = rateFor(policy, daysBefore);
  const currentDays = [...policy.rules].sort((a, b) => a.days_before - b.days_before).find((r) => daysBefore <= r.days_before)?.days_before ?? null;
  const rows = [{ label: `${daysLabel(rules[0].days_before + 1)}まで`, rate: 0, current: current === 0 }];
  rules.forEach((r, i) => {
    const next = rules[i + 1]?.days_before;
    const last = next == null ? 0 : next + 1;
    const to = last === r.days_before ? '' : `〜${daysLabel(last)}`;
    rows.push({ label: `${daysLabel(r.days_before)}${to}`, rate: r.rate_percent, current: current > 0 && currentDays === r.days_before });
  });
  if (policy.noShowPercent != null && policy.noShowPercent > 0) rows.push({ label: '不泊', rate: policy.noShowPercent, current: false });
  return rows;
}

// ---- 精算 ----

export type CancelSettlement = 'none' | 'invoice' | 'refund' | 'card' | 'deposit';

export type SettlementSource = {
  status: string;
  payment_option: string | null;
  payment_status: string;
  paid_amount: number | null;
  total_amount: number;
  bath_tax_amount: number;
  prepay_discount_amount: number;
  stripe_payment_method_id?: string | null;
  // デポジット（payment_option='deposit_online'・Phase 3b）
  deposit_amount?: number | null;
  remainder_option?: string | null;
  // 予約時に残した規定（事務手数料の率 admin_fee_percent・免除 admin_fee_waived もここ）
  cancel_policy?: unknown;
};

export function settlementOf(b: SettlementSource, fee: number): CancelSettlement {
  if (b.status === 'pending_payment') return 'none';
  if (b.payment_status === 'paid' && isDepositPaymentOption(b.payment_option)) return 'deposit';
  if (b.payment_status === 'paid') return 'refund';
  if (fee <= 0) return 'none';
  if (b.payment_option === 'online_checkin' && b.stripe_payment_method_id && (b.payment_status === 'scheduled' || b.payment_status === 'charge_failed')) return 'card';
  return 'invoice';
}

export type PartnerRefund = {
  paid: number;
  kept: number;
  refund: number;
  // デポジットのとき: キャンセル料がデポジットを超えた不足分と、そのうち請求書で請求する額
  // （2026-10-07 から精算先にかかわらず不足分＝請求額。互換のため両方の名前を残す）
  shortage: number;
  shortageBilled: number;
  // 差し引く額の理由（キャンセル料 / 割引 / 事務手数料）と、比べた事務手数料の額・率（率が無い予約は null）
  reason: KeptReason;
  adminFee: number;
  adminFeePercent: number | null;
};

/**
 * 予約時決済（支払済み）の返金額。直販（lib/direct-payment.ts の directRefundDueOf）と同じ:
 * 差し引く額 = max(キャンセル料, 割引額, 事務手数料)〔割引額・事務手数料は入湯税を除いた支払額まで＝入湯税は必ず返す〕。
 * キャンセル料を免除したとき（waived）は割引額も差し引かない。事務手数料は adminFeeWaived（省略時は予約の cancel_policy.admin_fee_waived）。
 * デポジット（deposit_online）は割引が無いので、充当＝min(max(キャンセル料, 事務手数料), デポジット)・返金＝デポジット−充当。
 */
export function partnerRefundOf(b: SettlementSource, fee: number, waived = false, adminFeeWaived?: boolean): PartnerRefund {
  const terms = readAdminFeeTerms(b.cancel_policy);
  const adminWaived = adminFeeWaived ?? terms.waived;
  if (isDepositPaymentOption(b.payment_option)) {
    const deposit = Math.max(0, b.paid_amount ?? b.deposit_amount ?? 0);
    const f = waived ? 0 : Math.max(0, fee);
    // 事務手数料はデポジットのうち宿泊料金に充てた分まで（デポジットが宿泊料金を超えた分＝入湯税は必ず返す。全額決済と同じ）
    const adminCap = Math.min(deposit, Math.max(0, b.total_amount));
    const adminFee = adminWaived ? 0 : Math.min(adminFeeOf(deposit, terms.percent), adminCap);
    const feeKept = Math.min(f, deposit);
    const kept = Math.max(feeKept, adminFee);
    const shortage = f - feeKept;
    const reason: KeptReason = kept <= 0 ? 'none' : adminFee > feeKept ? 'admin_fee' : 'cancel_fee';
    return {
      paid: deposit,
      kept,
      refund: deposit - kept,
      shortage,
      shortageBilled: shortage,
      reason,
      adminFee,
      adminFeePercent: terms.percent
    };
  }
  const paid = Math.max(0, b.paid_amount ?? b.total_amount + b.bath_tax_amount - b.prepay_discount_amount);
  const d = deductionOf({
    paid,
    bathTax: b.bath_tax_amount,
    fee,
    discount: b.prepay_discount_amount,
    adminFeePercent: terms.percent,
    waived,
    adminFeeWaived: adminWaived
  });
  return { paid, kept: d.kept, refund: paid - d.kept, shortage: 0, shortageBilled: 0, reason: d.reason, adminFee: d.adminFee, adminFeePercent: terms.percent };
}

/** 取消確認欄・メールの「どう精算するか」の一文 */
export function settlementText(
  s: CancelSettlement,
  fee: number,
  invoiceMonth: string,
  refund?: {
    refund: number;
    kept: number;
    paid?: number;
    shortage?: number;
    shortageBilled?: number;
    reason?: KeptReason;
    adminFeePercent?: number | null;
  } | null
): string {
  const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
  // 差し引く額の理由（事務手数料・割引のときだけ言葉を足す。キャンセル料は従来の文のまま）
  const why = refund?.reason && refund.reason !== 'cancel_fee' && refund.reason !== 'none' ? keptReasonLabel(refund.reason, refund.adminFeePercent) : '';
  switch (s) {
    case 'deposit': {
      if (!refund) return '';
      const head =
        refund.kept > 0
          ? `お支払い済みのデポジット ${yen(refund.paid ?? refund.kept + refund.refund)} から ${yen(refund.kept)} を${why || 'キャンセル料'}に充当し、${refund.refund > 0 ? `${yen(refund.refund)} をカードへ返金します` : '返金はありません'}`
          : `お支払い済みのデポジット ${yen(refund.paid ?? refund.refund)} を全額カードへ返金します`;
      const short = refund.shortage ?? 0;
      if (short <= 0) return head;
      // 不足分は残額の精算先（現地でも）にかかわらず請求書で請求する（2026-10-07）
      return `${head}。デポジットを超える ${yen(short)} は ${invoiceMonth}分の請求書でご請求します`;
    }
    case 'invoice':
      return `${invoiceMonth}分の請求書でご請求します（チェックアウト予定日の月）`;
    case 'card':
      return `ご登録のカードへ ${yen(fee)} をご請求します`;
    case 'refund':
      return refund
        ? refund.kept > 0
          ? `お支払い済みの金額から ${yen(refund.kept)}${why ? `（${why}）` : ''} を差し引き、${yen(refund.refund)} をカードへ返金します`
          : `お支払い済みの ${yen(refund.refund)} を全額カードへ返金します`
        : '';
    default:
      return '';
  }
}

export const invoiceMonthLabel = (checkOut: string) => `${Number(checkOut.slice(0, 4))}年${Number(checkOut.slice(5, 7))}月`;

/**
 * キャンセル料が無料の最終日（YYYY-MM-DD・宿泊日の「最初に料率がかかる日」の前日）。
 * 料率のある段が無い規定は null（＝取消の期限までずっと無料）。予約入力の帯「◯月◯日までキャンセル料無料」に使う。
 */
export function freeCancelUntil(checkIn: string, policy: CancelPolicy | null): string | null {
  const days = (policy?.rules ?? []).filter((r) => r.rate_percent > 0).map((r) => r.days_before);
  if (!days.length) return null;
  const d = new Date(`${checkIn}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (Math.max(...days) + 1));
  return d.toISOString().slice(0, 10);
}
