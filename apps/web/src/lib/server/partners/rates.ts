// 取引先向けの料金カレンダー（特別レート＋残室）を組み立てる。限定URLの画面・REST API・予約の見積もりで共通。
//
// 先計算（2026-10-09・docs/partner-rank-rates.md §7）: まず RPC public.rms_partner_portal_prices（service_role 専用）で
//   DB に保存済みの最終料金（ランク → 特別レート → 端数 → 最高 → 最低。計算は DB が正）と、毎回最新の残室・休館日を読む。
//   ready=true ならその料金をそのまま使う（priceMode = 'precomputed'・TS のルールは当てない）。
//   ready=false（未計算・計算の失敗・計算済みの範囲の外）や RPC の失敗なら、下の従来の経路に切り替える（priceMode = 'live'）。
//   特別レートの編集は RMS に移した（Book は読むだけ）。
//
// 従来の経路の元データは RPC public.rms_partner_portal_source（service_role 専用）:
//   - 料金 … booking.daily_rates の理論値（RMS のマスタ理論式。2026-09-26 決定: 料金計算の元は RMS の理論値）
//   - 残室 … PMS と同じ規則・休館日
// 返り値 jsonb は partner-pricing.ts の PartnerSourceDay[] / PartnerSourceInventory にそのまま渡せる形。
// 取引先ランク暦（2026-10-09・docs/partner-rank-rates.md）: p_partner を渡すと、その取引先 × 施設の暦が有効なら
//   料金は暦のランクで RMS の式から出す（priceSource = 'partner_rank'）。それ以外は従来どおり（'standard'）。
// autumn-rms 時代の TL 実売キャッシュ（loadRmsWorkbook / loadRateQuote / loadCalendarInventory）は使わない。
// 先行案内料金（advance:*）は元データに無いので、取引先の include_advance は実質効かない。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPartnerDays,
  isRetiredPlanName,
  mergePriceExtreme,
  partnerPlanCodeFilter,
  partnerPriceRange,
  type PartnerPriceExtreme,
  type PartnerRateDay,
  type PartnerSourceDay,
  type PartnerSourceInventory
} from '$lib/partner-pricing';
import { addDaysIso, isBookFacility, todayJst, type PartnerRow } from './store';

// 1回に取れる日数（RPC 側の上限 62 日の内側。autumn-rms の見積もり上限 RATE_QUOTE_MAX_NIGHTS = 31 と同じ）。
export const PARTNER_MAX_RANGE_DAYS = 31;

export type PartnerRange = { from: string; to: string; earliest: string; latest: string };

// 取引先に見せてよい範囲（今日〜max_days_ahead・公開終了日まで）。公開終了日が過去なら latest < earliest になる。
export function partnerPublicBounds(
  partner: Pick<PartnerRow, 'max_days_ahead' | 'valid_until'>,
  today = todayJst()
): { earliest: string; latest: string } {
  let latest = addDaysIso(today, partner.max_days_ahead);
  if (partner.valid_until && partner.valid_until < latest) latest = partner.valid_until;
  return { earliest: today, latest };
}

// 取引先に見せてよい範囲（partnerPublicBounds）に要求範囲を収める。
export function clampPartnerRange(
  partner: Pick<PartnerRow, 'max_days_ahead' | 'valid_until'>,
  from: string,
  to: string,
  today = todayJst()
): PartnerRange | null {
  const { earliest, latest } = partnerPublicBounds(partner, today);
  const f = from < earliest ? earliest : from;
  let t = to > latest ? latest : to;
  const maxTo = addDaysIso(f, PARTNER_MAX_RANGE_DAYS - 1);
  if (t > maxTo) t = maxTo;
  if (f > t) return null;
  return { from: f, to: t, earliest, latest };
}

export type PartnerRatesResult = {
  days: PartnerRateDay[];
  rooms: { roomCode: string; name: string }[];
  // 特別レートを当てる前のプラングループ（コードは部屋タイプ間で共通）。
  planOptions: { code: string; label: string; mealType: string | null }[];
  // 料金の元（取引先ランク暦 / TL のランク由来の理論値）。管理画面の表示用
  priceSource: PartnerPriceSource;
  // どちらで出したか: 'precomputed' = DB に保存済みの最終料金（rms_partner_portal_prices）／'live' = 従来の計算（TS のルール）
  priceMode: PartnerPriceMode;
  // 保存済みの料金を計算した時刻（precomputed のときだけ）
  computedAt: string | null;
};

export type PartnerPriceSource = 'partner_rank' | 'standard';
export type PartnerPriceMode = 'precomputed' | 'live';

// 取引先ごとの特別レートを当てる前の元データ（料金＋残室）。同じ施設・期間はしばらく使い回す
// （月の行き来や前後月の先読みで同じ範囲を何度も読むため）。
// 取引先ランク暦（2026-10-09）: 暦を使っていない取引先は従来どおり施設のキー（facility|from|to）で共有し、RPC に p_partner を渡さない。
// 暦を使っている取引先だけ料金が他と違うので partner|facility|from|to のキーで p_partner 付きで読む（キャッシュの件数を取引先数で増やさない）。
// 残室は「目安」表示なので、数分の遅れは許容する。Worker の isolate 内だけのキャッシュ。
type PartnerBase = {
  days: PartnerSourceDay[];
  inventory: Record<string, PartnerSourceInventory | undefined>;
  rooms: { roomCode: string; name: string }[];
  priceSource: PartnerPriceSource;
};
// 保存済みの最終料金（rms_partner_portal_prices）。ready=false は null（その間は従来の経路で出す）
type PrecomputedBase = PartnerBase & { computedAt: string | null; computedTo: string | null };
const BASE_TTL_MS = 3 * 60 * 1000;
// 保存済みの最終料金は短めに（RMS で暦・料金を変えたあと、見積もり・確定が古い最終料金のままにならないように。ready=false も同じ）
const PRE_TTL_MS = 60 * 1000;
// 料金の幅（loadPartnerPriceRange）が公開期間を31日ずつ最大24本読むので、カレンダー本体の分を押し出さない程度に持つ
// （1件は1か月ぶんの JSON。Workers のメモリ 128MB に収めるため増やさない）
const BASE_MAX_ENTRIES = 64;
// 保存済みの最終料金も同じキャッシュに置く（キー: pre|取引先|施設|from|to|特別レート。ready=false の null も PRE_TTL_MS の間は覚える）
const baseCache = new Map<string, { at: number; value: Promise<PartnerBase | PrecomputedBase | null> }>();

function cacheBase<T extends PartnerBase | null>(key: string, load: () => Promise<T>, ttlMs = BASE_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = baseCache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  baseCache.delete(key);
  baseCache.set(key, { at: now, value });
  // 失敗した結果は残さない（次のアクセスで取り直す）。
  value.catch(() => baseCache.delete(key));
  // 古い順（Map は挿入順）に上限まで捨てる。
  for (const k of baseCache.keys()) {
    if (baseCache.size <= BASE_MAX_ENTRIES) break;
    baseCache.delete(k);
  }
  return value;
}

// 保存済みの最終料金を読む。RPC の失敗は例外（呼び出し側で従来の経路へ）、ready=false は null
function loadPartnerPrecomputed(
  db: SupabaseClient,
  partnerId: string,
  facilityId: string,
  range: { from: string; to: string },
  // 特別レート（rms_partner_facilities.pricing）。キーに含め、RMS で変えたらすぐ別のキーで読み直す（loadPartnerPriceRange と同じ流儀）
  pricing: unknown
): Promise<PrecomputedBase | null> {
  const key = `pre|${partnerId}|${facilityId}|${range.from}|${range.to}|${JSON.stringify(pricing)}`;
  return cacheBase(key, async (): Promise<PrecomputedBase | null> => {
    const { data, error } = await db.rpc('rms_partner_portal_prices', {
      p_partner: partnerId,
      p_facility: facilityId,
      p_from: range.from,
      p_to: range.to
    });
    if (error) throw new Error(`保存済みの料金の読み込みに失敗しました: ${error.message}`);
    const d = (data ?? {}) as Partial<Omit<PrecomputedBase, 'computedTo'>> & { ready?: boolean; computedTo?: unknown };
    if (d.ready !== true) return null;
    return {
      days: Array.isArray(d.days) ? d.days : [],
      inventory: d.inventory && typeof d.inventory === 'object' ? d.inventory : {},
      rooms: Array.isArray(d.rooms) ? d.rooms : [],
      priceSource: d.priceSource === 'partner_rank' ? 'partner_rank' : 'standard',
      computedAt: typeof d.computedAt === 'string' ? d.computedAt : null,
      computedTo: typeof d.computedTo === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.computedTo) ? d.computedTo.slice(0, 10) : null
    };
  }, PRE_TTL_MS);
}

// 保存済みの料金で出せるか。計算済みの先端（computedTo）より先を、公開範囲（今日＋max_days_ahead）の内側で求められたら
// 従来の経路にする（日付が変わった直後〜毎日の計算までの間、公開範囲の最終日の料金が無いままにしない）。
function precomputedCovers(pre: PrecomputedBase, range: { to: string }, maxDaysAhead: number): boolean {
  if (!pre.computedTo || pre.computedTo >= range.to) return true;
  return pre.computedTo >= addDaysIso(todayJst(), maxDaysAhead);
}

// 取引先 × 施設で取引先ランク暦を使っているか（rms_partner_rank_settings.enabled・service_role）。60秒だけ使い回す。
// 読めないときは「使っていない」とみなさず例外にする（暦の取引先に TL のランクの料金＝誤った料金を出さない）。
const RANK_TTL_MS = 60 * 1000;
const RANK_MAX_ENTRIES = 500;
const rankCache = new Map<string, { at: number; value: Promise<boolean> }>();

export function partnerRankEnabled(db: SupabaseClient, partnerId: string, facilityId: string): Promise<boolean> {
  const key = `${partnerId}|${facilityId}`;
  const now = Date.now();
  const hit = rankCache.get(key);
  if (hit && now - hit.at < RANK_TTL_MS) return hit.value;
  const value = (async () => {
    const { data, error } = await db
      .from('rms_partner_rank_settings')
      .select('enabled')
      .eq('partner_id', partnerId)
      .eq('facility_id', facilityId)
      .maybeSingle();
    if (error) throw new Error(`料金の設定の読み込みに失敗しました: ${error.message}`);
    return (data as { enabled?: boolean } | null)?.enabled === true;
  })();
  setRankCache(key, value);
  return value;
}

function setRankCache(key: string, value: Promise<boolean>) {
  rankCache.delete(key);
  rankCache.set(key, { at: Date.now(), value });
  value.catch(() => rankCache.delete(key));
  for (const k of rankCache.keys()) {
    if (rankCache.size <= RANK_MAX_ENTRIES) break;
    rankCache.delete(k);
  }
}

// 期限内に分かっている暦の有無（無ければ undefined）
function peekPartnerRank(partnerId: string, facilityId: string): Promise<boolean> | undefined {
  const hit = rankCache.get(`${partnerId}|${facilityId}`);
  return hit && Date.now() - hit.at < RANK_TTL_MS ? hit.value : undefined;
}

// RPC の返り値（priceSource）で分かった暦の有無を覚える
function rememberPartnerRank(partnerId: string, facilityId: string, rank: boolean) {
  setRankCache(`${partnerId}|${facilityId}`, Promise.resolve(rank));
}

function loadPartnerBase(
  db: SupabaseClient,
  partnerId: string,
  facilityId: string,
  range: { from: string; to: string },
  rank: boolean,
  // 読むプランのコード（partnerPlanCodeFilter）。null = 全プラン
  planCodes: string[] | null
): Promise<PartnerBase> {
  const plans = planCodes ? planCodes.join(',') : '*';
  const key = rank
    ? `${partnerId}|${facilityId}|${range.from}|${range.to}|${plans}`
    : `${facilityId}|${range.from}|${range.to}|${plans}`;
  return cacheBase(key, async (): Promise<PartnerBase> => {
    const { data, error } = await db.rpc(
      'rms_partner_portal_source',
      {
        p_facility: facilityId,
        p_from: range.from,
        p_to: range.to,
        ...(rank ? { p_partner: partnerId } : {}),
        ...(planCodes ? { p_plan_codes: planCodes } : {})
      }
    );
    if (error) throw new Error(`料金の読み込みに失敗しました: ${error.message}`);
    const d = (data ?? {}) as Partial<PartnerBase>;
    return {
      days: Array.isArray(d.days) ? d.days : [],
      inventory: d.inventory && typeof d.inventory === 'object' ? d.inventory : {},
      rooms: Array.isArray(d.rooms) ? d.rooms : [],
      priceSource: d.priceSource === 'partner_rank' ? 'partner_rank' : 'standard'
    };
  });
}

export async function loadPartnerRates(
  db: SupabaseClient,
  partner: Pick<PartnerRow, 'id' | 'facility_id' | 'pricing' | 'show_inventory' | 'include_advance' | 'max_days_ahead'>,
  range: { from: string; to: string },
  filters: { rooms?: string[]; guests?: number[]; includeBase?: boolean } = {}
): Promise<PartnerRatesResult> {
  // Book が扱う施設以外の料金は出さない（store の withFacility でも弾いているが二重に確かめる）。
  if (!isBookFacility(partner.facility_id)) throw new Error(`未登録の施設です: ${partner.facility_id}`);
  // 1. 保存済みの最終料金（先計算・§7）。取引先ページ・API・料金表・予約の見積もり（booking.ts）・管理画面のプレビューで共通
  //    （取引先ページに出た料金と同じ値で予約を確定する）。読めない・ready=false なら従来の経路へ（取引先ページを止めない）
  const pre = await loadPartnerPrecomputed(db, partner.id, partner.facility_id, range, partner.pricing).catch(() => null);
  if (pre && precomputedCovers(pre, range, partner.max_days_ahead)) {
    // 暦の有無も覚えておく（従来の経路に切り替えたとき、施設で共有の元データを読むか取引先付きで読むかの判定に使う）
    rememberPartnerRank(partner.id, partner.facility_id, pre.priceSource === 'partner_rank');
    return buildRatesResult(pre, partner, filters, 'precomputed', pre.computedAt);
  }
  // 2. 従来の経路（rms_partner_portal_source ＋ TS のルール）
  // 暦を使うかが分かっていれば、使っていない取引先は施設で共有の元データを読む。まだ分からなければ（isolate の初回）
  // 取引先付きで RPC を1回呼び、返り値の priceSource で覚える（暦の有無を別に問い合わせる往復を省く・2026-10-09 重さ対策）
  // 取引先が売るプラン（特別レートの調整ルールで指定したもの）だけを読む（2026-10-09 重さ対策）
  const planCodes = partnerPlanCodeFilter(partner.pricing);
  const known = peekPartnerRank(partner.id, partner.facility_id);
  let base: PartnerBase;
  if (known) {
    base = await loadPartnerBase(db, partner.id, partner.facility_id, range, await known, planCodes);
  } else {
    base = await loadPartnerBase(db, partner.id, partner.facility_id, range, true, planCodes);
    rememberPartnerRank(partner.id, partner.facility_id, base.priceSource === 'partner_rank');
  }
  return buildRatesResult(base, partner, filters, 'live', null);
}

function buildRatesResult(
  base: PartnerBase,
  partner: Pick<PartnerRow, 'pricing' | 'show_inventory' | 'include_advance'>,
  filters: { rooms?: string[]; guests?: number[]; includeBase?: boolean },
  priceMode: PartnerPriceMode,
  computedAt: string | null
): PartnerRatesResult {
  const { days: sourceDays, inventory, rooms, priceSource } = base;
  const days = buildPartnerDays(sourceDays, inventory, {
    pricing: partner.pricing,
    rooms,
    showInventory: partner.show_inventory,
    includeAdvance: partner.include_advance,
    roomFilter: filters.rooms,
    guestFilter: filters.guests,
    includeBase: filters.includeBase,
    // 保存済みの料金は特別レートまで当てた最終料金なので、ルールを当て直さない
    pricesFinal: priceMode === 'precomputed'
  });
  const planMap = new Map<string, { code: string; label: string; mealType: string | null }>();
  for (const day of sourceDays) {
    for (const o of day.options) {
      if (o.planGroupCode.startsWith('advance:') || planMap.has(o.planGroupCode) || isRetiredPlanName(o.planLabel)) continue;
      planMap.set(o.planGroupCode, { code: o.planGroupCode, label: o.planLabel, mealType: o.mealType ?? null });
    }
  }
  return { days, rooms, planOptions: [...planMap.values()], priceSource, priceMode, computedAt };
}

// ---------------------------------------------------------------------------
// 公開期間の料金の幅（料金カレンダー上部のカード。2026-10-01 追加）
// ---------------------------------------------------------------------------

// 公開範囲（今日〜max_days_ahead・公開終了日。clampPartnerRange と同じ規則）を、1回に取れる日数（31日）ずつに分ける。
export function partnerRangeChunks(
  partner: Pick<PartnerRow, 'max_days_ahead' | 'valid_until'>,
  today = todayJst()
): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = [];
  let from = today;
  // 上限は max_days_ahead の範囲（最長でも1年ぶん程度）。念のため回数も抑える
  for (let i = 0; i < 40; i += 1) {
    const r = clampPartnerRange(partner, from, addDaysIso(from, PARTNER_MAX_RANGE_DAYS - 1), today);
    if (!r) break;
    chunks.push({ from: r.from, to: r.to });
    if (r.to >= r.latest) break;
    from = addDaysIso(r.to, 1);
  }
  return chunks;
}

// min / max は根拠（日付・部屋・プラン・人数）つき。画面のツールチップに出す。
export type PartnerPriceRange = { min: PartnerPriceExtreme; max: PartnerPriceExtreme; from: string; to: string };

// 取引先・施設・料金の元（暦を使うか）・料金設定・公開範囲が同じなら isolate 内で10分使い回す（範囲全体を読むので重い）。
// 施設はキーに含める（複数施設化で、同じ取引先でも選んでいる施設で幅が違う）。暦の切替は次の読み込みで別のキーになる。
const RANGE_TTL_MS = 10 * 60 * 1000;
const RANGE_MAX_ENTRIES = 50;
// 2026-10-09: 4 → 2。ページを開いた直後のカレンダー本体（月の料金）と DB を取り合って重くなっていたため
const RANGE_CONCURRENCY = 2;
// isolate をまたいで使い回す KV の保存期間（秒）。isolate は頻繁に入れ替わるので、KV が無いと開くたびに1年分を読み直す
const RANGE_KV_TTL_SEC = 60 * 60;
const RANGE_KV_PREFIX = 'partner-price-range:v1:';
// KV の最小限の形（AB_CONFIG）。無い環境（vite dev 等）は isolate 内のキャッシュだけ
type RangeKv = { get(key: string): Promise<string | null>; put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> };

async function rangeKvKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return RANGE_KV_PREFIX + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const rangeCache = new Map<string, { at: number; value: Promise<PartnerPriceRange | null> }>();

// 公開期間の1名1泊の最低・最高（部屋タイプ・人数・プランを問わない。休館・非表示は除く）。料金が1つも無ければ null。
export async function loadPartnerPriceRange(
  db: SupabaseClient,
  partner: Pick<PartnerRow, 'id' | 'facility_id' | 'pricing' | 'show_inventory' | 'include_advance' | 'max_days_ahead' | 'valid_until'>,
  today = todayJst(),
  kv: RangeKv | null = null
): Promise<PartnerPriceRange | null> {
  const chunks = partnerRangeChunks(partner, today);
  const rank = await partnerRankEnabled(db, partner.id, partner.facility_id);
  const key = `${partner.id}|${partner.facility_id}|${rank ? 'rank' : 'std'}|${today}|${partner.max_days_ahead}|${partner.valid_until ?? ''}|${partner.include_advance}|${JSON.stringify(partner.pricing)}`;
  const now = Date.now();
  const hit = rangeCache.get(key);
  if (hit && now - hit.at < RANGE_TTL_MS) return hit.value;
  const value = (async () => {
    if (!chunks.length) return null;
    // KV（キーは isolate 内と同じ文字列のハッシュ＝料金設定・暦の切替・日付が変われば別のキー）
    const kvKey = kv ? await rangeKvKey(key) : null;
    if (kv && kvKey) {
      try {
        const cached = await kv.get(kvKey);
        if (cached) return JSON.parse(cached) as PartnerPriceRange | null;
      } catch {
        // KV が読めなければ計算する
      }
    }
    const result = await computeRange();
    if (kv && kvKey) {
      try {
        await kv.put(kvKey, JSON.stringify(result), { expirationTtl: RANGE_KV_TTL_SEC });
      } catch {
        // 保存できなくても結果は返す
      }
    }
    return result;
  })();
  async function computeRange(): Promise<PartnerPriceRange | null> {
    let min: PartnerPriceExtreme | null = null;
    let max: PartnerPriceExtreme | null = null;
    // 同時に読むのは RANGE_CONCURRENCY 本まで（RPC を一度に投げすぎない）
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const c = chunks[next++];
        const { days } = await loadPartnerRates(db, partner, c);
        const r = partnerPriceRange(days);
        if (r) {
          // 根拠の並び（日付順）はマージ時に揃えるので、チャンクの完了順に依らない
          min = mergePriceExtreme(min, r.min, (x, y) => x < y);
          max = mergePriceExtreme(max, r.max, (x, y) => x > y);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(RANGE_CONCURRENCY, chunks.length) }, worker));
    if (!min || !max) return null;
    return { min, max, from: chunks[0].from, to: chunks[chunks.length - 1].to };
  }
  rangeCache.delete(key);
  rangeCache.set(key, { at: now, value });
  // 失敗した結果は残さない（次のアクセスで取り直す）。
  value.catch(() => rangeCache.delete(key));
  for (const k of rangeCache.keys()) {
    if (rangeCache.size <= RANGE_MAX_ENTRIES) break;
    rangeCache.delete(k);
  }
  return value;
}

// ---------------------------------------------------------------------------
// 取引先ランク暦の状態（管理画面の「料金の元」。2026-10-09・docs/partner-rank-rates.md §5.4）
// ---------------------------------------------------------------------------

// 取引先ランク暦の編集画面（RMS）。Book に RMS のオリジンの設定が無いので定数で持つ（PMS_GUEST_URL_BASE と同じ流儀）
export const RMS_ORIGIN = 'https://autumn-rms.yamado.app';
export const rmsPartnerRatesUrl = (partnerId: string, facilitySlug: string) =>
  `${RMS_ORIGIN}/partner-rates/${encodeURIComponent(partnerId)}?facility=${encodeURIComponent(facilitySlug)}`;

export type PartnerRankStatus = {
  enabled: boolean;
  // 公開範囲（partnerPublicBounds）の日数と、そのうち未設定の日（暦の行が無い日・施設の有効なランクセットに無いコードの日。
  // どちらも取引先ページで売らない。「不可」は設定済みとして数えない）
  publicDays: number;
  missingDays: number;
};

/** 取引先 × 施設の取引先ランク暦の状態。読めなければ null（画面は表示を省く） */
export async function loadPartnerRankStatus(
  db: SupabaseClient,
  partner: Pick<PartnerRow, 'id' | 'facility_id' | 'max_days_ahead' | 'valid_until'>,
  today = todayJst()
): Promise<PartnerRankStatus | null> {
  const { data, error } = await db
    .from('rms_partner_rank_settings')
    .select('enabled')
    .eq('partner_id', partner.id)
    .eq('facility_id', partner.facility_id)
    .maybeSingle();
  if (error) return null;
  const enabled = (data as { enabled?: boolean } | null)?.enabled === true;
  const { earliest, latest } = partnerPublicBounds(partner, today);
  const publicDays = latest < earliest ? 0 : Math.round((Date.parse(`${latest}T00:00:00Z`) - Date.parse(`${earliest}T00:00:00Z`)) / 86_400_000) + 1;
  if (!enabled || !publicDays) return { enabled, publicDays, missingDays: 0 };
  // 施設の有効なランクセットのランクコード（料金の RPC と同じ: rms_rate_rank_sets.is_active → rms_rate_rank_prices.rank_code）
  const { data: sets, error: e1 } = await db.from('rms_rate_rank_sets').select('id').eq('facility_id', partner.facility_id).eq('is_active', true);
  if (e1) return null;
  const setIds = ((sets ?? []) as { id: string }[]).map((s) => s.id);
  let codes: string[] = [];
  if (setIds.length) {
    const { data: prices, error: e3 } = await db.from('rms_rate_rank_prices').select('rank_code').in('rate_rank_set_id', setIds);
    if (e3) return null;
    codes = [...new Set(((prices ?? []) as { rank_code: string }[]).map((p) => p.rank_code))];
  }
  const { count, error: e2 } = await db
    .from('rms_partner_rank_days')
    .select('stay_date', { count: 'exact', head: true })
    .eq('partner_id', partner.id)
    .eq('facility_id', partner.facility_id)
    .in('rank_code', [...codes, '不可'])
    .gte('stay_date', earliest)
    .lte('stay_date', latest);
  if (e2) return null;
  return { enabled, publicDays, missingDays: Math.max(0, publicDays - (count ?? 0)) };
}
