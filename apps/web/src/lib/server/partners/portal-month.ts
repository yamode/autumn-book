// 限定URLの料金カレンダー: 1か月ぶんのデータを組み立てる（ページの初回表示と、月・人数切替の JSON で共通）。
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PartnerRateDay } from '$lib/partner-pricing';
import { addDaysIso, todayJst, type PartnerContext } from './store';
import { clampPartnerRange, loadPartnerRates } from './rates';

const pad = (n: number) => String(n).padStart(2, '0');

export type PortalMonth = {
  month: { year: number; month: number; start: string; end: string };
  bounds: { earliest: string; latest: string };
  guests: number;
  rooms: { roomCode: string; name: string }[];
  days: PartnerRateDay[];
  fetchedAt: string | null;
};

export function parsePortalQuery(url: URL, today = todayJst()) {
  const monthParam = url.searchParams.get('month') ?? today.slice(0, 7);
  const [y, m] = monthParam.split('-').map(Number);
  const valid = Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12;
  const year = valid ? y : Number(today.slice(0, 4));
  const month = valid ? m : Number(today.slice(5, 7));
  const guestsRaw = Number(url.searchParams.get('guests') ?? 2);
  const guests = Number.isInteger(guestsRaw) && guestsRaw >= 1 && guestsRaw <= 20 ? guestsRaw : 2;
  return { year, month, guests };
}

export async function loadPortalMonth(
  db: SupabaseClient,
  partner: PartnerContext,
  q: { year: number; month: number; guests: number },
  today = todayJst()
): Promise<PortalMonth> {
  const start = `${q.year}-${pad(q.month)}-01`;
  const end = new Date(Date.UTC(q.year, q.month, 0)).toISOString().slice(0, 10);
  const range = clampPartnerRange(partner, start, end, today);
  const latest = range?.latest ?? addDaysIso(today, partner.max_days_ahead);
  const rates = range
    ? await loadPartnerRates(db, partner, range, { guests: [q.guests] })
    : { days: [], rooms: [] };
  return {
    month: { year: q.year, month: q.month, start, end },
    bounds: { earliest: today, latest },
    guests: q.guests,
    rooms: rates.rooms,
    days: rates.days,
    fetchedAt: null // 理論値（booking.daily_rates）には取得時刻が無い。画面側は null なら表示しない
  };
}
