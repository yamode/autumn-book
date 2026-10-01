// 取引先向けの料金カレンダー（特別レート＋残室）を組み立てる。限定URLの画面・REST API・予約の見積もりで共通。
//
// 元データは RPC public.rms_partner_portal_source（service_role 専用）:
//   - 料金 … booking.daily_rates の理論値（RMS のマスタ理論式。2026-09-26 決定: 料金計算の元は RMS の理論値）
//   - 残室 … PMS と同じ規則・休館日
// 返り値 jsonb は partner-pricing.ts の PartnerSourceDay[] / PartnerSourceInventory にそのまま渡せる形。
// autumn-rms 時代の TL 実売キャッシュ（loadRmsWorkbook / loadRateQuote / loadCalendarInventory）は使わない。
// 先行案内料金（advance:*）は元データに無いので、取引先の include_advance は実質効かない。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPartnerDays,
  isRetiredPlanName,
  partnerPriceRange,
  type PartnerRateDay,
  type PartnerSourceDay,
  type PartnerSourceInventory
} from '$lib/partner-pricing';
import { addDaysIso, isBookFacility, todayJst, type PartnerRow } from './store';

// 1回に取れる日数（RPC 側の上限 62 日の内側。autumn-rms の見積もり上限 RATE_QUOTE_MAX_NIGHTS = 31 と同じ）。
export const PARTNER_MAX_RANGE_DAYS = 31;

export type PartnerRange = { from: string; to: string; earliest: string; latest: string };

// 取引先に見せてよい範囲（今日〜max_days_ahead・公開終了日まで）に要求範囲を収める。
export function clampPartnerRange(
  partner: Pick<PartnerRow, 'max_days_ahead' | 'valid_until'>,
  from: string,
  to: string,
  today = todayJst()
): PartnerRange | null {
  const earliest = today;
  let latest = addDaysIso(today, partner.max_days_ahead);
  if (partner.valid_until && partner.valid_until < latest) latest = partner.valid_until;
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
};

// 取引先ごとの特別レートを当てる前の元データ（料金＋残室）。取引先・API で共通なので、
// 同じ施設・期間はしばらく使い回す（月の行き来や前後月の先読みで同じ範囲を何度も読むため）。
// 残室は「目安」表示なので、数分の遅れは許容する。Worker の isolate 内だけのキャッシュ。
type PartnerBase = {
  days: PartnerSourceDay[];
  inventory: Record<string, PartnerSourceInventory | undefined>;
  rooms: { roomCode: string; name: string }[];
};
const BASE_TTL_MS = 3 * 60 * 1000;
// 料金の幅（loadPartnerPriceRange）が公開期間を31日ずつ最大24本読むので、カレンダー本体の分を押し出さない程度に持つ
const BASE_MAX_ENTRIES = 64;
const baseCache = new Map<string, { at: number; value: Promise<PartnerBase> }>();

function loadPartnerBase(db: SupabaseClient, facilityId: string, range: { from: string; to: string }): Promise<PartnerBase> {
  const key = `${facilityId}|${range.from}|${range.to}`;
  const now = Date.now();
  const hit = baseCache.get(key);
  if (hit && now - hit.at < BASE_TTL_MS) return hit.value;
  const value = (async () => {
    const { data, error } = await db.rpc('rms_partner_portal_source', { p_facility: facilityId, p_from: range.from, p_to: range.to });
    if (error) throw new Error(`料金の読み込みに失敗しました: ${error.message}`);
    const d = (data ?? {}) as Partial<PartnerBase>;
    return {
      days: Array.isArray(d.days) ? d.days : [],
      inventory: d.inventory && typeof d.inventory === 'object' ? d.inventory : {},
      rooms: Array.isArray(d.rooms) ? d.rooms : []
    };
  })();
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

export async function loadPartnerRates(
  db: SupabaseClient,
  partner: Pick<PartnerRow, 'facility_id' | 'pricing' | 'show_inventory' | 'include_advance'>,
  range: { from: string; to: string },
  filters: { rooms?: string[]; guests?: number[]; includeBase?: boolean } = {}
): Promise<PartnerRatesResult> {
  // Book が扱う施設以外の料金は出さない（store の withFacility でも弾いているが二重に確かめる）。
  if (!isBookFacility(partner.facility_id)) throw new Error(`未登録の施設です: ${partner.facility_id}`);
  const { days: sourceDays, inventory, rooms } = await loadPartnerBase(db, partner.facility_id, range);
  const days = buildPartnerDays(sourceDays, inventory, {
    pricing: partner.pricing,
    rooms,
    showInventory: partner.show_inventory,
    includeAdvance: partner.include_advance,
    roomFilter: filters.rooms,
    guestFilter: filters.guests,
    includeBase: filters.includeBase
  });
  const planMap = new Map<string, { code: string; label: string; mealType: string | null }>();
  for (const day of sourceDays) {
    for (const o of day.options) {
      if (o.planGroupCode.startsWith('advance:') || planMap.has(o.planGroupCode) || isRetiredPlanName(o.planLabel)) continue;
      planMap.set(o.planGroupCode, { code: o.planGroupCode, label: o.planLabel, mealType: o.mealType ?? null });
    }
  }
  return { days, rooms, planOptions: [...planMap.values()] };
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

export type PartnerPriceRange = { min: number; max: number; from: string; to: string };

// 取引先・料金設定・公開範囲が同じなら isolate 内で10分使い回す（範囲全体を読むので重い）。
const RANGE_TTL_MS = 10 * 60 * 1000;
const RANGE_MAX_ENTRIES = 50;
const RANGE_CONCURRENCY = 4;
const rangeCache = new Map<string, { at: number; value: Promise<PartnerPriceRange | null> }>();

// 公開期間の1名1泊の最低・最高（部屋タイプ・人数・プランを問わない。休館・非表示は除く）。料金が1つも無ければ null。
export function loadPartnerPriceRange(
  db: SupabaseClient,
  partner: Pick<PartnerRow, 'id' | 'facility_id' | 'pricing' | 'show_inventory' | 'include_advance' | 'max_days_ahead' | 'valid_until'>,
  today = todayJst()
): Promise<PartnerPriceRange | null> {
  const chunks = partnerRangeChunks(partner, today);
  const key = `${partner.id}|${today}|${partner.max_days_ahead}|${partner.valid_until ?? ''}|${partner.include_advance}|${JSON.stringify(partner.pricing)}`;
  const now = Date.now();
  const hit = rangeCache.get(key);
  if (hit && now - hit.at < RANGE_TTL_MS) return hit.value;
  const value = (async () => {
    if (!chunks.length) return null;
    let min = Infinity;
    let max = -Infinity;
    // 同時に読むのは4本まで（RPC を一度に投げすぎない）
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const c = chunks[next++];
        const { days } = await loadPartnerRates(db, partner, c);
        const r = partnerPriceRange(days);
        if (r) {
          if (r.min < min) min = r.min;
          if (r.max > max) max = r.max;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(RANGE_CONCURRENCY, chunks.length) }, worker));
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min, max, from: chunks[0].from, to: chunks[chunks.length - 1].to };
  })();
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
