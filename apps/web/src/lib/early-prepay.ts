// 早期決済割（予約時決済 × 宿泊日までの日数で段階的に上がる割引）の純関数。画面とサーバで共有する。
//
// 金額の正は DB（autumn-shared 20260926221912 の book._early_prepay_discount → direct_payment_prepare）。
// ここは同じ式で画面の表示と、サーバが PaymentIntent を作る前の突き合わせに使う。1円でもずれると支払が止まるので、
// 率は千分率の整数・金額は BigInt で計算する（浮動小数を使わない）。
//
//   泊ごとの率 = max(プランの定率, 段階表の率〔施設で ON・プランが対象・除外期間外〕)。上限 20%。
//   段階表の率 = 「今日（JST）から宿泊初日までの日数」が days 以上の段のうち最大の percent。
//   割引額 = floor(Σ 泊の小計 × 泊の率 / 1000)。明細の合計が宿泊料金と違うときは加重平均の率を宿泊料金に当てる。

export type EarlyPrepayTier = { days: number; percent: number };
export type EarlyPrepayBlackout = { from: string; to: string; label: string };
export type EarlyPrepaySettings = {
  enabled: boolean;
  tiers: EarlyPrepayTier[];
  blackouts: EarlyPrepayBlackout[];
};

/** Fable の提案による初期値（1カ月・3カ月・半年）。 */
export const DEFAULT_EARLY_PREPAY_TIERS: EarlyPrepayTier[] = [
  { days: 30, percent: 3 },
  { days: 90, percent: 5 },
  { days: 180, percent: 8 }
];
export const EARLY_PREPAY_MAX_TIERS = 4;
export const EARLY_PREPAY_MAX_BLACKOUTS = 40;
/** 率の上限（千分率）。PREPAY_DISCOUNT_MAX（20%）と同じ */
const MAX_PERMILLE = 200;

export const NO_EARLY_PREPAY: EarlyPrepaySettings = { enabled: false, tiers: [], blackouts: [] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** DB の行・画面の入力を正規形にする（壊れた値は捨てる。検証は validateEarlyPrepaySettings）。 */
export function normalizeEarlyPrepaySettings(raw: unknown): EarlyPrepaySettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const tiersRaw = Array.isArray(src.tiers) ? src.tiers : Array.isArray(src.early_prepay_tiers) ? src.early_prepay_tiers : [];
  const blackRaw = Array.isArray(src.blackouts)
    ? src.blackouts
    : Array.isArray(src.early_prepay_blackouts)
      ? src.early_prepay_blackouts
      : [];
  const tiers = tiersRaw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({ days: Math.round(Number(t.days)), percent: Math.round(Number(t.percent) * 10) / 10 }))
    .filter((t) => Number.isFinite(t.days) && Number.isFinite(t.percent));
  const blackouts = blackRaw
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .map((b) => ({ from: String(b.from ?? ''), to: String(b.to ?? ''), label: String(b.label ?? '').trim().slice(0, 40) }))
    .filter((b) => DATE_RE.test(b.from) && DATE_RE.test(b.to));
  const enabled = src.enabled ?? src.early_prepay_enabled;
  return { enabled: enabled === true, tiers, blackouts };
}

/** 保存前の検証（SQL の admin_save_payment_settings と同じ条件）。問題があれば日本語のメッセージ。 */
export function validateEarlyPrepaySettings(s: EarlyPrepaySettings): string | null {
  if (s.tiers.length > EARLY_PREPAY_MAX_TIERS) return `段階は ${EARLY_PREPAY_MAX_TIERS} 段までです。`;
  if (s.enabled && s.tiers.length === 0) return '早期決済割を使うときは、段階を1つ以上入れてください。';
  let prevD = 0;
  let prevP = 0;
  for (const [i, t] of s.tiers.entries()) {
    if (!Number.isInteger(t.days) || t.days < 1 || t.days > 365) return `${i + 1}段目: 日数は 1〜365 日で入れてください。`;
    if (!(t.percent >= 1 && t.percent <= 20)) return `${i + 1}段目: 割引率は 1〜20% で入れてください。`;
    if (t.days <= prevD) return `${i + 1}段目: 日数は上の段より大きくしてください。`;
    if (t.percent <= prevP) return `${i + 1}段目: 割引率は上の段より大きくしてください。`;
    prevD = t.days;
    prevP = t.percent;
  }
  if (s.blackouts.length > EARLY_PREPAY_MAX_BLACKOUTS) return `除外期間は ${EARLY_PREPAY_MAX_BLACKOUTS} 件までです。`;
  for (const [i, b] of s.blackouts.entries()) {
    if (b.to < b.from) return `除外期間${i + 1}: 終了日を開始日以降にしてください。`;
    if (daysBetween(b.from, b.to) > 366) return `除外期間${i + 1}: 1年を超える期間は入れられません。`;
  }
  return null;
}

// ---- 日付（YYYY-MM-DD・JST） ----

/** 今日の日付（JST・YYYY-MM-DD） */
export function todayJstIso(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** b − a（日数）。どちらも YYYY-MM-DD */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const inBlackout = (date: string, blackouts: EarlyPrepayBlackout[]) => blackouts.some((b) => date >= b.from && date <= b.to);

/** 宿泊初日までの日数に当たる段階表の率（千分率）。当たらなければ 0。 */
export function tierPermilleOf(tiers: EarlyPrepayTier[], leadDays: number): number {
  let best = 0;
  for (const t of tiers) if (leadDays >= t.days) best = Math.max(best, Math.round(t.percent * 10));
  return Math.min(Math.max(best, 0), MAX_PERMILLE);
}

export type PrepayDiscountInput = {
  /** 宿泊料金（price_snapshot.total・割引前） */
  total: number;
  /** 泊ごとの明細（price_snapshot.lines）。無ければ宿泊初日で判定して全体に当てる */
  lines?: { date: string; subtotal: number }[];
  checkIn: string;
  today: string;
  /** プランの定率（0〜0.2・book.plan_contents.prepay_discount_rate） */
  flatRate: number;
  /** プランが早期決済割の対象か（book.plan_contents.early_prepay） */
  earlyEligible: boolean;
  settings: EarlyPrepaySettings;
};

export type PrepayDiscountDetail = {
  discount: number;
  leadDays: number;
  /** 段階表の率（千分率・除外期間は考えない） */
  tierPermille: number;
  flatPermille: number;
  /** 実際に当たった泊の率の最大（千分率） */
  maxPermille: number;
  blackoutNights: number;
  nights: number;
};

/** 予約時決済の割引額と内訳（SQL の book._early_prepay_discount と同じ式）。 */
export function prepayDiscountDetail(q: PrepayDiscountInput): PrepayDiscountDetail {
  const leadDays = daysBetween(q.today, q.checkIn);
  const flat = Math.min(Math.max(Math.round((q.flatRate || 0) * 1000), 0), MAX_PERMILLE);
  const tier = q.settings.enabled && q.earlyEligible ? tierPermilleOf(q.settings.tiers, leadDays) : 0;
  const total = Math.max(0, Math.round(q.total));
  const lines = (q.lines ?? []).filter((l) => !!l.date);

  let sum = 0n;
  let num = 0n;
  let max = 0;
  let black = 0;
  for (const l of lines) {
    let rate: number;
    if (tier > 0 && inBlackout(l.date, q.settings.blackouts)) {
      black++;
      rate = flat;
    } else rate = Math.max(flat, tier);
    const s = BigInt(Math.round(l.subtotal || 0));
    sum += s;
    num += s * BigInt(rate);
    max = Math.max(max, rate);
  }

  let discount: number;
  if (lines.length === 0 || sum <= 0n) {
    let rate: number;
    if (tier > 0 && inBlackout(q.checkIn, q.settings.blackouts)) {
      rate = flat;
      black = 1;
    } else rate = Math.max(flat, tier);
    max = rate;
    discount = Number((BigInt(total) * BigInt(rate)) / 1000n);
  } else if (sum === BigInt(total)) {
    discount = Number(num / 1000n);
  } else {
    discount = Number((BigInt(total) * num) / (sum * 1000n));
  }

  return {
    discount: Math.max(0, Math.min(discount, total)),
    leadDays,
    tierPermille: tier,
    flatPermille: flat,
    maxPermille: max,
    blackoutNights: black,
    nights: Math.max(lines.length, 1)
  };
}

/**
 * 今の段が下がるまでの日数（画面の「あと N 日で X% → Y% になります」用）。
 * 宿泊初日が近づくと段が下がる。今の段が 0% なら null。withinDays を超えて先なら null（煽りすぎない）。
 */
export function nextTierDrop(
  tiers: EarlyPrepayTier[],
  leadDays: number,
  withinDays = 7
): { inDays: number; fromPercent: number; toPercent: number } | null {
  const sorted = [...tiers].sort((a, b) => a.days - b.days);
  const idx = sorted.findLastIndex((t) => leadDays >= t.days);
  if (idx < 0) return null;
  const cur = sorted[idx];
  // leadDays が cur.days を下回る日（= leadDays - cur.days + 1 日後）に1つ下の段になる
  const inDays = leadDays - cur.days + 1;
  if (inDays > withinDays) return null;
  return { inDays, fromPercent: cur.percent, toPercent: idx > 0 ? sorted[idx - 1].percent : 0 };
}

/** 率（%）の表示。3 → "3"、2.5 → "2.5" */
export const percentText = (p: number) => (Number.isInteger(p) ? String(p) : p.toFixed(1));
