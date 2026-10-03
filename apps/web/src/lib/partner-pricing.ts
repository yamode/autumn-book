// 取引先・エージェント向け「特別レート」の定義と計算（サーバ・画面共通の純関数）。
//
// 基準価格は料金カレンダーと同じ TL 実売価格（1名あたり・税込・入湯税別）。取引先ごとの
// pricing（rms_partners.pricing）で次のように加工する:
//   1. ルールを上から順に見て、最初に当てはまったルールで決める（部屋タイプ・プラン・食事・人数・
//      期間・曜日で絞り込み）。ルールは「調整（％・円/人・固定単価）」か「非表示」。
//   2. どのルールにも当てはまらない料金は出さない（公開するのは、ルールで明示的に指定したプランだけ）。
//      「調整して出す」ルールはプランの指定が必須（未指定で全プランが出てしまうのを防ぐ）。
//   3. 端数処理（単位・切り捨て/四捨五入/切り上げ）→ 下限単価。
// 休館日・販売停止中のプランは出さない。残室数は取引先の設定で出す／出さないを切り替える。
import { isHoliday } from '$lib/holidays';

export type PartnerAdjustType = 'percent' | 'amount' | 'fixed';
export type PartnerRuleAction = 'adjust' | 'hide';
export type PartnerRoundingMode = 'floor' | 'round' | 'ceil';

// 祝日は曜日番号 7 として扱う（0=日 … 6=土, 7=祝日）。
export const HOLIDAY_WEEKDAY = 7;
export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土', '祝'];
// 先行案内料金（TL 未販売期間の料金）をまとめて指すプランコード。
export const ADVANCE_PLAN_CODE = 'advance';

export type PartnerRateRule = {
  id: string;
  label: string;
  roomCodes: string[]; // 空 = すべて
  planGroupCodes: string[]; // 空 = すべて（'advance' = 先行案内料金すべて）
  mealTypes: string[]; // 空 = すべて（素泊 / 朝食 / 2食）
  guestCounts: number[]; // 空 = すべて
  weekdays: number[]; // 空 = すべて（0-6, 7=祝日）
  dateFrom: string | null;
  dateTo: string | null;
  action: PartnerRuleAction;
  adjustType: PartnerAdjustType;
  // percent: 符号つき％（-10 = 10%引き）/ amount: 符号つき円/人（-1000 = 1名1,000円引き）/ fixed: 1名あたりの固定単価
  value: number;
};

export type PartnerPricing = {
  // 常に 'hide'（ルールに当てはまらない料金は出さない）。旧データの 'adjust' は読込時に 'hide' へ寄せる。
  defaultAction: PartnerRuleAction;
  defaultAdjustType: Exclude<PartnerAdjustType, 'fixed'>;
  defaultValue: number;
  rules: PartnerRateRule[];
  roundingUnit: number; // 1 / 10 / 100 / 1000
  roundingMode: PartnerRoundingMode;
  // 1名1泊あたりの下限・上限（税込）。ルール・端数処理で決まったプラン料金をこの範囲に収める（上書き）。
  // 上限は 2026-10-01 追加。null = 制限なし。
  minPricePerPerson: number | null;
  maxPricePerPerson: number | null;
};

export const DEFAULT_PARTNER_PRICING: PartnerPricing = {
  defaultAction: 'hide',
  defaultAdjustType: 'percent',
  defaultValue: 0,
  rules: [],
  roundingUnit: 100,
  roundingMode: 'floor',
  minPricePerPerson: null,
  maxPricePerPerson: null
};

const ROUNDING_UNITS = [1, 10, 100, 1000];
const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? '').trim()).filter(Boolean))] : [];
const intList = (v: unknown, min: number, max: number): number[] =>
  Array.isArray(v)
    ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= min && n <= max))].sort((a, b) => a - b)
    : [];
const finite = (v: unknown, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

// DB の jsonb / 画面からの入力を、欠けや不正値を補って正規形にする（保存前・読込時の両方で通す）。
export function normalizePartnerPricing(raw: unknown): PartnerPricing {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rulesRaw = Array.isArray(src.rules) ? src.rules : [];
  const rules: PartnerRateRule[] = rulesRaw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r, i) => {
      const adjustType: PartnerAdjustType =
        r.adjustType === 'amount' || r.adjustType === 'fixed' ? r.adjustType : 'percent';
      return {
        id: String(r.id ?? '').trim() || `rule-${i + 1}`,
        label: String(r.label ?? '').trim().slice(0, 80),
        roomCodes: strList(r.roomCodes),
        planGroupCodes: strList(r.planGroupCodes),
        mealTypes: strList(r.mealTypes),
        guestCounts: intList(r.guestCounts, 1, 99),
        weekdays: intList(r.weekdays, 0, HOLIDAY_WEEKDAY),
        dateFrom: isIsoDate(r.dateFrom) ? r.dateFrom : null,
        dateTo: isIsoDate(r.dateTo) ? r.dateTo : null,
        action: r.action === 'hide' ? 'hide' : 'adjust',
        adjustType,
        value: finite(r.value)
      };
    });
  const unit = Number(src.roundingUnit);
  const limit = (v: unknown) => {
    const n = v == null || v === '' ? null : finite(v, NaN);
    return n != null && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  return {
    defaultAction: 'hide',
    defaultAdjustType: src.defaultAdjustType === 'amount' ? 'amount' : 'percent',
    defaultValue: finite(src.defaultValue),
    rules,
    roundingUnit: ROUNDING_UNITS.includes(unit) ? unit : DEFAULT_PARTNER_PRICING.roundingUnit,
    roundingMode: src.roundingMode === 'round' || src.roundingMode === 'ceil' ? src.roundingMode : 'floor',
    minPricePerPerson: limit(src.minPricePerPerson),
    maxPricePerPerson: limit(src.maxPricePerPerson)
  };
}

// 保存時の検証（normalize で吸収できない、明らかな入力ミスを弾く）。問題があればメッセージを返す。
export function validatePartnerPricing(p: PartnerPricing): string | null {
  const checkAdjust = (type: PartnerAdjustType, value: number, where: string) => {
    if (type === 'percent' && (value <= -100 || value > 300)) return `${where}: ％は -99〜300 の範囲で指定してください。`;
    if (type === 'fixed' && value <= 0) return `${where}: 固定単価は 1円以上で指定してください。`;
    if (Math.abs(value) > 10_000_000) return `${where}: 値が大きすぎます。`;
    return null;
  };
  for (const [i, r] of p.rules.entries()) {
    const where = `ルール${i + 1}${r.label ? `「${r.label}」` : ''}`;
    if (r.dateFrom && r.dateTo && r.dateFrom > r.dateTo) return `${where}: 期間の開始日が終了日より後です。`;
    if (r.action === 'adjust') {
      if (!r.planGroupCodes.length) return `${where}: 公開するプランを選んでください（選んだプランだけを出します）。`;
      const e = checkAdjust(r.adjustType, r.value, where);
      if (e) return e;
    }
  }
  if (p.rules.length > 200) return 'ルールは200件までです。';
  if (p.minPricePerPerson != null && p.maxPricePerPerson != null && p.minPricePerPerson > p.maxPricePerPerson) {
    return '最低料金が最高料金を上回っています。';
  }
  return null;
}

export type PartnerRateTarget = {
  date: string;
  roomCode: string;
  planGroupCode: string;
  mealType?: string;
  guestCount: number;
};

const planMatches = (codes: string[], planGroupCode: string) =>
  codes.length === 0 ||
  codes.includes(planGroupCode) ||
  (planGroupCode.startsWith(`${ADVANCE_PLAN_CODE}:`) && codes.includes(ADVANCE_PLAN_CODE));

export function ruleMatches(rule: PartnerRateRule, t: PartnerRateTarget): boolean {
  if (rule.roomCodes.length && !rule.roomCodes.includes(t.roomCode)) return false;
  if (!planMatches(rule.planGroupCodes, t.planGroupCode)) return false;
  if (rule.mealTypes.length && !(t.mealType && rule.mealTypes.includes(t.mealType))) return false;
  if (rule.guestCounts.length && !rule.guestCounts.includes(t.guestCount)) return false;
  if (rule.dateFrom && t.date < rule.dateFrom) return false;
  if (rule.dateTo && t.date > rule.dateTo) return false;
  if (rule.weekdays.length) {
    // 祝日は「祝」を選んだルールに当てはまる。祝を選んでいないルールでは本来の曜日で判定する。
    const holiday = isHoliday(t.date);
    const dow = new Date(`${t.date}T00:00:00Z`).getUTCDay();
    const hit = rule.weekdays.includes(dow) || (holiday && rule.weekdays.includes(HOLIDAY_WEEKDAY));
    if (!hit) return false;
  }
  return true;
}

function roundTo(value: number, unit: number, mode: PartnerRoundingMode): number {
  const u = unit > 0 ? unit : 1;
  const q = value / u;
  // 浮動小数の誤差（例: 9900 * 0.9 = 8910.000000000002）で切り上げ／切り捨てがずれないよう丸めてから処理する。
  const fixed = Math.round(q * 1e6) / 1e6;
  const r = mode === 'ceil' ? Math.ceil(fixed) : mode === 'round' ? Math.round(fixed) : Math.floor(fixed);
  return r * u;
}

function adjust(base: number, type: PartnerAdjustType, value: number): number {
  if (type === 'fixed') return value;
  if (type === 'amount') return base + value;
  return base * (1 + value / 100);
}

export type PartnerPriceDecision = { hidden: true; ruleId?: string } | { hidden: false; price: number; ruleId?: string };

// 最低料金・最高料金（1名1泊）で上書きする。端数処理の後に当てるので、設定した額がそのまま出る。
export function clampPartnerPrice(price: number, pricing: Pick<PartnerPricing, 'minPricePerPerson' | 'maxPricePerPerson'>): number {
  let p = price;
  if (pricing.maxPricePerPerson != null && p > pricing.maxPricePerPerson) p = pricing.maxPricePerPerson;
  if (pricing.minPricePerPerson != null && p < pricing.minPricePerPerson) p = pricing.minPricePerPerson;
  return p;
}

// 公開期間の料金の幅（部屋タイプ・人数・プランを問わない1名1泊の最低・最高）。休館日・非表示は除く。
// 最低・最高それぞれに「どの日・部屋・プラン・人数の料金か」の根拠を付ける（2026-10-01 指示: ツールチップで見せる）。
// 同額が多数あるときは日付順に先頭 PRICE_RANGE_SAMPLE_LIMIT 件だけ持ち、件数（count）は全部数える。
// planCode: 取引先向けのプラン名（booking_settings.planNames）に引き直すため（2026-10-03）
export type PartnerPriceBasis = { date: string; roomName: string; planCode: string; planName: string; guests: number };
export type PartnerPriceExtreme = { price: number; count: number; samples: PartnerPriceBasis[] };
export type PartnerPriceRangeDetail = { min: PartnerPriceExtreme; max: PartnerPriceExtreme };
export const PRICE_RANGE_SAMPLE_LIMIT = 5;

const byBasis = (a: PartnerPriceBasis, b: PartnerPriceBasis) =>
  a.date.localeCompare(b.date) || a.roomName.localeCompare(b.roomName) || a.planName.localeCompare(b.planName) || a.guests - b.guests;

// 同じ極値（price）の根拠を足し合わせる。price が違えば良い方（better）を残す。
export function mergePriceExtreme(
  a: PartnerPriceExtreme | null,
  b: PartnerPriceExtreme | null,
  better: (x: number, y: number) => boolean
): PartnerPriceExtreme | null {
  if (!a) return b;
  if (!b) return a;
  if (a.price !== b.price) return better(a.price, b.price) ? a : b;
  return { price: a.price, count: a.count + b.count, samples: [...a.samples, ...b.samples].sort(byBasis).slice(0, PRICE_RANGE_SAMPLE_LIMIT) };
}

export function partnerPriceRange(days: PartnerRateDay[]): PartnerPriceRangeDetail | null {
  let min: PartnerPriceExtreme | null = null;
  let max: PartnerPriceExtreme | null = null;
  for (const d of days) {
    if (d.closed) continue;
    for (const r of d.rooms) {
      for (const p of r.plans) {
        for (const [g, v] of Object.entries(p.pricesPerPerson)) {
          if (!(v > 0)) continue;
          const one: PartnerPriceExtreme = {
            price: v,
            count: 1,
            samples: [{ date: d.date, roomName: r.roomName, planCode: p.planCode, planName: p.planName, guests: Number(g) }]
          };
          min = mergePriceExtreme(min, one, (x, y) => x < y);
          max = mergePriceExtreme(max, one, (x, y) => x > y);
        }
      }
    }
  }
  return min && max ? { min, max } : null;
}

// 1名あたりの基準価格（税込）に特別レートを当てる。非表示なら hidden。
export function decidePartnerPrice(pricing: PartnerPricing, target: PartnerRateTarget, basePrice: number): PartnerPriceDecision {
  const rule = pricing.rules.find((r) => ruleMatches(r, target));
  const action = rule ? rule.action : pricing.defaultAction;
  if (action === 'hide') return { hidden: true, ruleId: rule?.id };
  const type = rule ? rule.adjustType : pricing.defaultAdjustType;
  const value = rule ? rule.value : pricing.defaultValue;
  let price = roundTo(adjust(basePrice, type, value), pricing.roundingUnit, pricing.roundingMode);
  price = clampPartnerPrice(price, pricing);
  if (!(price > 0)) return { hidden: true, ruleId: rule?.id };
  return { hidden: false, price, ruleId: rule?.id };
}

// ---- 1日ぶんの料金カレンダーを組み立てる ----

// 入力: 料金カレンダーの候補（rate-quote.ts の RateQuoteOption と同じ形の必要部分）。
export type PartnerSourceOption = {
  planGroupCode: string;
  planLabel: string;
  roomCode?: string;
  mealType?: string;
  salesStatus?: string; // 1販売中 / 2停止中 / 3一部停止
  pricesByGuest: Record<number, number>;
};
export type PartnerSourceDay = { date: string; options: PartnerSourceOption[] };
export type PartnerSourceInventory = {
  isClosed: boolean | null;
  remainingRoomCount: number | null;
  byRoomType?: { remaining: number; roomCode?: string }[];
};

export type PartnerRatePlan = {
  planCode: string;
  planName: string;
  mealType: string | null;
  advance: boolean;
  pricesPerPerson: Record<string, number>; // 人数 → 1名あたり特別レート（税込・入湯税別）
  basePricesPerPerson?: Record<string, number>; // スタッフのプレビュー用（取引先には出さない）
};
export type PartnerRateRoom = {
  roomCode: string;
  roomName: string;
  remainingRooms: number | null;
  plans: PartnerRatePlan[];
};
export type PartnerRateDay = {
  date: string;
  closed: boolean;
  remainingRooms: number | null;
  rooms: PartnerRateRoom[];
};

export type BuildPartnerDaysOptions = {
  pricing: PartnerPricing;
  rooms: { roomCode: string; name: string }[];
  showInventory: boolean;
  includeAdvance: boolean;
  roomFilter?: string[];
  guestFilter?: number[];
  includeBase?: boolean; // スタッフのプレビュー時だけ true
};

const STOPPED_SALES_STATUS = '2';

// 廃止・据え置きのプラングループ（命名の慣習マーク）。TL には同じコード（a000 等）のまま
// 「…旧プラン」が古い価格で残っていることがあり、取引先に出すと同名プランが2つ・別価格に見える。
export const RETIRED_PLAN_NAME_MARKS = ['旧プラン', '×××', '削除予定'];
export const isRetiredPlanName = (name: string) => RETIRED_PLAN_NAME_MARKS.some((mark) => name.includes(mark));

export function buildPartnerDays(
  days: PartnerSourceDay[],
  inventory: Record<string, PartnerSourceInventory | undefined>,
  opts: BuildPartnerDaysOptions
): PartnerRateDay[] {
  const roomOrder = new Map(opts.rooms.map((r, i) => [r.roomCode, i]));
  const roomName = new Map(opts.rooms.map((r) => [r.roomCode, r.name]));
  const roomFilter = opts.roomFilter?.length ? new Set(opts.roomFilter) : null;
  const guestFilter = opts.guestFilter?.length ? new Set(opts.guestFilter) : null;

  return days.map((day) => {
    const inv = inventory[day.date];
    if (inv?.isClosed) return { date: day.date, closed: true, remainingRooms: opts.showInventory ? 0 : null, rooms: [] };

    const byRoom = new Map<string, PartnerRatePlan[]>();
    for (const option of day.options) {
      const advance = option.planGroupCode.startsWith(`${ADVANCE_PLAN_CODE}:`);
      if (advance && !opts.includeAdvance) continue;
      if (option.salesStatus === STOPPED_SALES_STATUS) continue;
      if (!advance && isRetiredPlanName(option.planLabel)) continue;
      const roomCode = option.roomCode ?? '';
      if (!roomCode) continue;
      if (roomFilter && !roomFilter.has(roomCode)) continue;

      const prices: Record<string, number> = {};
      const base: Record<string, number> = {};
      for (const [g, p] of Object.entries(option.pricesByGuest)) {
        const guestCount = Number(g);
        if (!(p > 0) || !Number.isInteger(guestCount)) continue;
        if (guestFilter && !guestFilter.has(guestCount)) continue;
        const decision = decidePartnerPrice(
          opts.pricing,
          { date: day.date, roomCode, planGroupCode: option.planGroupCode, mealType: option.mealType, guestCount },
          p
        );
        if (decision.hidden) continue;
        prices[g] = decision.price;
        base[g] = p;
      }
      if (!Object.keys(prices).length) continue;
      const plan: PartnerRatePlan = {
        planCode: option.planGroupCode,
        planName: option.planLabel,
        mealType: option.mealType ?? null,
        advance,
        pricesPerPerson: prices
      };
      if (opts.includeBase) plan.basePricesPerPerson = base;
      const list = byRoom.get(roomCode) ?? [];
      list.push(plan);
      byRoom.set(roomCode, list);
    }

    const remainingOf = (roomCode: string): number | null => {
      if (!opts.showInventory || !inv?.byRoomType?.length) return null;
      const hits = inv.byRoomType.filter((r) => r.roomCode === roomCode);
      return hits.length ? hits.reduce((s, r) => s + Math.max(0, r.remaining), 0) : null;
    };

    const rooms: PartnerRateRoom[] = [...byRoom.entries()]
      .sort(([a], [b]) => (roomOrder.get(a) ?? 999) - (roomOrder.get(b) ?? 999) || a.localeCompare(b))
      .map(([roomCode, plans]) => ({
        roomCode,
        roomName: roomName.get(roomCode) ?? roomCode,
        remainingRooms: remainingOf(roomCode),
        plans
      }));

    let remainingRooms: number | null = null;
    if (opts.showInventory) {
      const known = rooms.map((r) => r.remainingRooms).filter((n): n is number => n != null);
      // 部屋タイプ別の残室が取れた日は、公開している部屋タイプの合計。取れない日は施設合計。
      // 公開している部屋が1つも無い日は、施設合計を出すと別の部屋の空き具合を見せてしまうので出さない。
      remainingRooms = known.length ? known.reduce((s, n) => s + n, 0) : rooms.length ? (inv?.remainingRoomCount ?? null) : null;
    }
    return { date: day.date, closed: false, remainingRooms, rooms };
  });
}

// ルールの説明文（画面表示用）。
export function describeAdjust(action: PartnerRuleAction, type: PartnerAdjustType, value: number): string {
  if (action === 'hide') return '非表示';
  if (type === 'fixed') return `1名 ${value.toLocaleString()}円（固定）`;
  if (type === 'amount') {
    if (value === 0) return '実売価格のまま';
    return value < 0 ? `1名 ${Math.abs(value).toLocaleString()}円引き` : `1名 ${value.toLocaleString()}円増し`;
  }
  if (value === 0) return '実売価格のまま';
  return value < 0 ? `${Math.abs(value)}%引き` : `${value}%増し`;
}
