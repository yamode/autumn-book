// 取引先ページの「月ごとの料金」（料金カレンダー・プランのご紹介が読む JSON）を KV（AB_CONFIG）に一時保存する。
// 2026-10-09: DB（Supabase の計算資源が小さく、PMS などと同居）で料金のページがメモリから追い出され、
// 1回の取得が 0.7 秒前後かかる（2回目は 0.1 秒）。開くたびに3か月ぶん読むので重かった。
//
// 古いものを先に返して裏で取り直す（stale-while-revalidate）:
//   - FRESH_MS 以内 … そのまま返す
//   - STALE_MS 以内 … 先に返し、waitUntil で取り直して保存する
//   - それより古い・無い … その場で読み、保存して返す
// 2026-10-09: 料金を DB で先に計算して保存するようになり読み出しが軽くなったので、3分／20分 → 1分／5分に短くした
// （RMS で特別レート・暦を変えたときの反映を早くする）。
// 残室は「目安」の表示（予約の見積もり・確定は毎回 DB から読み直す＝ここは通らない）なので、数分の遅れは許容する。
// キーは取引先・施設・今日・月・人数・料金設定のハッシュ（特別レート・公開範囲が変われば別のキー）。
// 取引先ランク暦（RMS）の塗り替えは、最長 STALE_MS 後に反映される。
import type { PartnerContext } from './store';
import type { PortalMonth } from './portal-month';

const FRESH_MS = 60 * 1000;
const STALE_MS = 5 * 60 * 1000;
const KV_TTL_SEC = 30 * 60;
const PREFIX = 'partner-month:v1:';

type Kv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
};

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function portalMonthCacheKey(
  partner: Pick<
    PartnerContext,
    'id' | 'facility_id' | 'pricing' | 'show_inventory' | 'include_advance' | 'max_days_ahead' | 'valid_until' | 'facility_available'
  >,
  q: { year: number; month: number; guests: number },
  today: string
): Promise<string> {
  const raw = [
    partner.id,
    partner.facility_id,
    today,
    `${q.year}-${q.month}`,
    q.guests,
    partner.show_inventory,
    partner.include_advance,
    partner.max_days_ahead,
    partner.valid_until ?? '',
    partner.facility_available,
    JSON.stringify(partner.pricing)
  ].join('|');
  return PREFIX + (await sha256Hex(raw));
}

export async function cachedPortalMonth(
  kv: Kv | null,
  key: string,
  load: () => Promise<PortalMonth>,
  waitUntil: ((p: Promise<unknown>) => void) | null
): Promise<PortalMonth> {
  if (!kv) return load();
  const save = async (body: PortalMonth) => {
    try {
      await kv.put(key, JSON.stringify({ at: Date.now(), body }), { expirationTtl: KV_TTL_SEC });
    } catch {
      // 保存できなくても結果は返す
    }
  };
  let hit: { at: number; body: PortalMonth } | null = null;
  try {
    const raw = await kv.get(key);
    if (raw) hit = JSON.parse(raw) as { at: number; body: PortalMonth };
  } catch {
    hit = null;
  }
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < FRESH_MS) return hit.body;
  if (hit && age < STALE_MS && waitUntil) {
    // 先に古い結果を返し、裏で取り直す（失敗しても次の読み込みでまた取り直す）
    waitUntil(load().then(save).catch(() => undefined));
    return hit.body;
  }
  const body = await load();
  await save(body);
  return body;
}
