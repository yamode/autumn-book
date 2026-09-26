// @autumn-book/core — 料金計算・キャンセル料計算・日付ユーティリティ（純粋関数のみ）
// 設計書 §5.2: quote ロジックは SQL 側と二重検証するため、ここに正の実装を置く

export interface CancellationRule {
  /** チェックイン何日前から適用されるか（例: 3 = 3日前以降） */
  days_before: number;
  /** キャンセル料率 0〜1 */
  rate: number;
}

export interface CancellationPolicy {
  rules: CancellationRule[]; // days_before 降順で評価
  note?: string;
}

export interface QuoteInput {
  checkin: string; // YYYY-MM-DD
  nights: number;
  adults: number;
  children: number;
  /** 日付 → 大人1名単価 */
  nightlyRate: (date: string) => number;
  taxRate?: number; // 既定 0.10（内税表示）
  pointsUsed?: number;
}

export interface QuoteLine {
  date: string;
  unitPrice: number;
  adults: number;
  subtotal: number;
}

export interface Quote {
  lines: QuoteLine[];
  /** 税込総額（1室） */
  total: number;
  /** 1名あたり税込 */
  perPerson: number;
  /** 内消費税 */
  taxIncluded: number;
  pointsUsed: number;
  /** ポイント利用後支払額 */
  payable: number;
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nightsBetween(checkin: string, checkout: string): number {
  const a = new Date(checkin + 'T00:00:00Z').getTime();
  const b = new Date(checkout + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

export function eachNight(checkin: string, nights: number): string[] {
  return Array.from({ length: nights }, (_, i) => addDays(checkin, i));
}

export function formatYen(n: number): string {
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}

export function calcQuote(input: QuoteInput): Quote {
  const taxRate = input.taxRate ?? 0.1;
  const lines: QuoteLine[] = eachNight(input.checkin, input.nights).map((date) => {
    const unitPrice = input.nightlyRate(date);
    return { date, unitPrice, adults: input.adults, subtotal: unitPrice * input.adults };
  });
  const total = lines.reduce((s, l) => s + l.subtotal, 0);
  const pointsUsed = Math.min(input.pointsUsed ?? 0, total);
  return {
    lines,
    total,
    perPerson: Math.round(total / Math.max(1, input.adults)),
    taxIncluded: Math.round(total - total / (1 + taxRate)),
    pointsUsed,
    payable: total - pointsUsed
  };
}

/** チェックイン日と基準日からキャンセル料率を返す */
export function cancellationRate(policy: CancellationPolicy, checkin: string, today: string): number {
  const daysBefore = nightsBetween(today, checkin);
  // days_before 昇順（直前ほど高率）で、daysBefore がしきい値以下の最も厳しいルールを適用
  const sorted = [...policy.rules].sort((a, b) => a.days_before - b.days_before);
  for (const rule of sorted) {
    if (daysBefore <= rule.days_before) return rule.rate;
  }
  return 0;
}

export function cancellationFee(policy: CancellationPolicy, checkin: string, today: string, total: number): number {
  return Math.round(total * cancellationRate(policy, checkin, today));
}

/**
 * グレード別キャンセル料率（設計書 §3.3・SQL book._cancel_fee と同式）。
 * プラン規定（snapshot）の rules が非空ならプラン規定を優先し、空なら会員グレードの
 * ルール表（rankRules）を使う。いずれも days_before 昇順で最初に該当した率を返す。
 * 既存 cancellationRate / cancellationFee は変更しない（後方互換）。
 *
 * @param planPolicy 予約のプラン規定 snapshot（bookings.cancellation_policy_snapshot 相当）
 * @param rankRules  会員グレードのルール表（rank_cancel_policies.rules 相当・非会員は standard）
 * @returns source（'plan' | 'rank'）と rate（0〜1）
 */
export function cancellationRateForRank(
  planPolicy: CancellationPolicy | null | undefined,
  rankRules: CancellationRule[],
  checkin: string,
  today: string
): { source: 'plan' | 'rank'; rate: number } {
  const planRules = planPolicy?.rules ?? [];
  const usePlan = planRules.length > 0;
  const rules = usePlan ? planRules : (rankRules ?? []);
  const daysBefore = nightsBetween(today, checkin);
  const sorted = [...rules].sort((a, b) => a.days_before - b.days_before);
  let rate = 0;
  for (const rule of sorted) {
    if (daysBefore <= rule.days_before) {
      rate = rule.rate;
      break;
    }
  }
  return { source: usePlan ? 'plan' : 'rank', rate };
}

/** 「6/20まで無料」等の動的文言を生成（設計書 §7） */
export function cancelPolicyLabel(policy: CancellationPolicy, checkin: string): string {
  const sorted = [...policy.rules].filter((r) => r.rate > 0).sort((a, b) => b.days_before - a.days_before);
  if (sorted.length === 0) return 'キャンセル料はかかりません';
  const firstCharged = sorted[0];
  const freeUntil = addDays(checkin, -(firstCharged.days_before + 1));
  const [, m, d] = freeUntil.split('-');
  return `${Number(m)}/${Number(d)}までキャンセル無料`;
}

/** ポイント付与額（税抜額 × 還元率） */
export function earnedPoints(total: number, rewardRate: number, taxRate = 0.1): number {
  return Math.floor((total / (1 + taxRate)) * rewardRate);
}
