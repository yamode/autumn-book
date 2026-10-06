// 取引先予約のキャンセル料（2026-10-06 指示・サーバ・画面共通の純関数）。
//
// - 基準額: 税込の予約金額から入湯税を引いた額。予約時決済の割引などが入っていても、割引前の金額で計算する
//   （＝台帳の total_amount）。料率を掛けて円未満は切り捨て。
// - 料率: 予約時点の規定（rms_partner_bookings.cancel_policy）。無い予約（導入前）は今のプランの規定
//   （プラン個別 → 施設の既定。取引先ページのキャンセルポリシーと同じ）。
// - 取消の日: 宿泊日の何日前か（JST の暦日）。規定は「N日前から X%」なので、N 以下で最も小さい段を当てる。
// - 精算: 支払方法で決まる（settlementOf）。
//     請求書払い・自由入力の支払方法 … 月末の請求書（チェックアウト予定日の月）に不課税で載せる
//     予約時決済（支払済み） … 支払額から差し引いて返金。差し引く額は直販と同じく max(キャンセル料, 割引額)
//     チェックイン日決済（カード登録のみ・未請求） … 取消時に登録カードへ請求（失敗したら請求書へ回す）
// - 請求書上は「逸失利益に対する損害賠償金」として不課税で計上する（消費税の対象外）。
import { normalizeRules, type Rule } from '$lib/partner-plan-terms';

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

export type CancelSettlement = 'none' | 'invoice' | 'refund' | 'card';

export type SettlementSource = {
  status: string;
  payment_option: string | null;
  payment_status: string;
  paid_amount: number | null;
  total_amount: number;
  bath_tax_amount: number;
  prepay_discount_amount: number;
  stripe_payment_method_id?: string | null;
};

export function settlementOf(b: SettlementSource, fee: number): CancelSettlement {
  if (b.status === 'pending_payment') return 'none';
  if (b.payment_status === 'paid') return 'refund';
  if (fee <= 0) return 'none';
  if (b.payment_option === 'online_checkin' && b.stripe_payment_method_id && (b.payment_status === 'scheduled' || b.payment_status === 'charge_failed')) return 'card';
  return 'invoice';
}

/**
 * 予約時決済（支払済み）の返金額。直販（lib/direct-payment.ts の directRefundDueOf）と同じ:
 * 差し引く額 = max(キャンセル料, 割引額〔入湯税を除いた支払額まで＝入湯税は必ず返す〕)。免除したときは全額返金。
 */
export function partnerRefundOf(b: SettlementSource, fee: number, waived = false): { paid: number; kept: number; refund: number } {
  const paid = Math.max(0, b.paid_amount ?? b.total_amount + b.bath_tax_amount - b.prepay_discount_amount);
  let kept = Math.min(Math.max(0, fee), paid);
  if (!waived) {
    const cap = Math.max(0, paid - Math.max(0, b.bath_tax_amount));
    kept = Math.max(kept, Math.min(Math.max(0, b.prepay_discount_amount), cap));
  }
  return { paid, kept, refund: paid - kept };
}

/** 取消確認欄・メールの「どう精算するか」の一文 */
export function settlementText(s: CancelSettlement, fee: number, invoiceMonth: string, refund?: { refund: number; kept: number } | null): string {
  const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
  switch (s) {
    case 'invoice':
      return `${invoiceMonth}分の請求書でご請求します（チェックアウト予定日の月）`;
    case 'card':
      return `ご登録のカードへ ${yen(fee)} をご請求します`;
    case 'refund':
      return refund ? `お支払い済みの金額から ${yen(refund.kept)} を差し引き、${yen(refund.refund)} をカードへ返金します` : '';
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
