// 取引先ページ: 日付を選ぶ前の「今後3か月の最安」（部屋 × プランごとの1名あたり最安）をサーバで組み立てる。
// 2026-10-10: 以前は画面が表示されてから月の JSON を3本（日 × 部屋 × プランの全量）取りに行き、画面側で最安を計算していた。
// ページの読み込み（stay-page.ts）と同時にここを始めて結果だけを流すので、
// 「画面のプログラムが動き出す → 取りに行く」の待ちと、3本ぶんのログイン確認・転送・計算が無くなる。
// 月の中身は月の JSON と同じ KV の一時保存（portal-month-cache.ts）を使い回す（料金の反映の遅れも同じ）。
import type { SupabaseClient } from '@supabase/supabase-js';
import { partnerReferencePlans, type PartnerReferencePlan } from '$lib/partner-stay';
import type { PartnerContext } from './store';
import { loadPortalMonth, type PortalMonth } from './portal-month';
import { cachedPortalMonth, portalMonthCacheKey } from './portal-month-cache';

type Platform = { platform?: App.Platform };

/** 1か月ぶんの料金（KV の一時保存つき）。月の JSON（/calendar/month）と共通 */
export async function getPortalMonth(
  event: Platform,
  db: SupabaseClient,
  partner: PartnerContext,
  q: { year: number; month: number; guests: number },
  today: string
): Promise<PortalMonth> {
  const key = await portalMonthCacheKey(partner, q, today);
  const ctx = event.platform?.context;
  return cachedPortalMonth(
    event.platform?.env?.AB_CONFIG ?? null,
    key,
    () => loadPortalMonth(db, partner, q, today),
    ctx ? (p) => ctx.waitUntil(p) : null
  );
}

const shiftYm = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
};

/** 今日から3か月（今月・翌月・翌々月）の、部屋 × プランごとの1名あたり最安。2・3か月目は読めなければ無しで出す */
export async function loadPortalReference(
  event: Platform,
  db: SupabaseClient,
  partner: PartnerContext,
  guests: number,
  today: string
): Promise<PartnerReferencePlan[]> {
  const months = await Promise.all(
    [0, 1, 2].map((i) => {
      const p = getPortalMonth(event, db, partner, { ...shiftYm(today.slice(0, 7), i), guests }, today);
      return i === 0 ? p : p.catch(() => null);
    })
  );
  const days = months.flatMap((m) => m?.days ?? []);
  return partnerReferencePlans(days, guests, { showInventory: partner.show_inventory, from: today });
}
