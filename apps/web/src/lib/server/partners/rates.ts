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
const BASE_MAX_ENTRIES = 24;
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
