// 日本の祝日判定（自己完結・依存なし）。
// 対象は概ね 2023 年以降の現行ルール（オリンピック特例等の過去の移動は扱わない）。
// 固定祝日・ハッピーマンデー・春分/秋分（近似式）・振替休日・国民の休日に対応する。
//
// 注意: 「休館日」は祝日とは別概念。将来 PMS から休館日フラグを連携する予定なので、
// カレンダー側では isHoliday() とは独立に休館日を扱う（[[calendar-inventory-pms]] 参照）。

const pad = (n: number) => String(n).padStart(2, '0');

/** Date | 'YYYY-MM-DD' を 'YYYY-MM-DD' に正規化する。 */
export function toIsoDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function iso(year: number, month1: number, day: number): string {
  return `${year}-${pad(month1)}-${pad(day)}`;
}

// 指定年・月(1-12)・第n週の月曜日の日付を返す（ハッピーマンデー用）。
function nthMonday(year: number, month1: number, nth: number): number {
  const firstDow = new Date(year, month1 - 1, 1).getDay(); // 0=日
  const firstMonday = 1 + ((8 - firstDow) % 7);
  return firstMonday + (nth - 1) * 7;
}

// 春分の日（近似式・1980〜2099 で有効）。
function vernalEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

// 秋分の日（近似式・1980〜2099 で有効）。
function autumnalEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
}

// その年の「国民の祝日」（振替休日・国民の休日を含まない素の祝日）一覧を返す。
function baseHolidays(year: number): Map<string, string> {
  const map = new Map<string, string>();
  const add = (month1: number, day: number, name: string) => map.set(iso(year, month1, day), name);

  add(1, 1, '元日');
  add(1, nthMonday(year, 1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  if (year >= 2020) add(2, 23, '天皇誕生日');
  add(3, vernalEquinoxDay(year), '春分の日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  add(7, nthMonday(year, 7, 3), '海の日');
  add(8, 11, '山の日');
  add(9, nthMonday(year, 9, 3), '敬老の日');
  add(9, autumnalEquinoxDay(year), '秋分の日');
  add(10, nthMonday(year, 10, 2), 'スポーツの日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');

  return map;
}

// 振替休日・国民の休日を加味した、その年の全祝日マップ。年単位でメモ化する。
const cache = new Map<number, Map<string, string>>();

function holidayMapForYear(year: number): Map<string, string> {
  const cached = cache.get(year);
  if (cached) return cached;

  const base = baseHolidays(year);
  const result = new Map(base);

  // 国民の休日: 前後を祝日に挟まれた平日（日曜以外）は休日になる。
  // 主に秋分まわりのシルバーウィークで発生する。素の祝日だけで判定する。
  for (const dateStr of base.keys()) {
    const d = new Date(`${dateStr}T00:00:00`);
    const prev = new Date(d);
    prev.setDate(d.getDate() - 2);
    const middle = new Date(d);
    middle.setDate(d.getDate() - 1);
    const prevStr = toIsoDate(prev);
    const middleStr = toIsoDate(middle);
    if (base.has(prevStr) && !base.has(middleStr) && middle.getDay() !== 0) {
      if (!result.has(middleStr)) result.set(middleStr, '国民の休日');
    }
  }

  // 振替休日: 祝日が日曜なら、次の「祝日でない日」が振替休日になる。
  for (const dateStr of base.keys()) {
    const d = new Date(`${dateStr}T00:00:00`);
    if (d.getDay() !== 0) continue; // 日曜のみ
    const sub = new Date(d);
    do {
      sub.setDate(sub.getDate() + 1);
    } while (base.has(toIsoDate(sub)));
    const subStr = toIsoDate(sub);
    if (!result.has(subStr)) result.set(subStr, '振替休日');
  }

  cache.set(year, result);
  return result;
}

/** 祝日名を返す（祝日でなければ null）。 */
export function holidayName(value: Date | string): string | null {
  const isoStr = toIsoDate(value);
  const year = Number(isoStr.slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return holidayMapForYear(year).get(isoStr) ?? null;
}

/** 祝日かどうか。 */
export function isHoliday(value: Date | string): boolean {
  return holidayName(value) !== null;
}
