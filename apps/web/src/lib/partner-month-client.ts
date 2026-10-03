// 取引先専用ページ（ブラウザ側）: 料金カレンダーの月データ（/p/<token>/calendar/month）の取得。
// 同じ月・人数はページ内で1回だけ取り、同時に頼まれたものは同じ通信を使う（プラン紹介のカレンダーが複数あっても重ならない）。
// view を付けないので、アクセスログには残らない（料金カレンダーのページで見た月だけ記録する）。
import type { PartnerRateDay } from '$lib/partner-pricing';

export type PortalMonthJson = {
  month: { year: number; month: number; start: string; end: string };
  bounds: { earliest: string; latest: string };
  guests: number;
  rooms: { roomCode: string; name: string }[];
  days: PartnerRateDay[];
};

const cache = new Map<string, Promise<PortalMonthJson>>();

export function fetchPortalMonth(token: string, month: string, guests: number): Promise<PortalMonthJson> {
  const key = `${token}|${month}|${guests}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = fetch(`/p/${encodeURIComponent(token)}/calendar/month?${new URLSearchParams({ month, guests: String(guests) })}`, {
    headers: { accept: 'application/json' }
  }).then((r) => {
    if (!r.ok) throw new Error(`month ${r.status}`);
    return r.json() as Promise<PortalMonthJson>;
  });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}
