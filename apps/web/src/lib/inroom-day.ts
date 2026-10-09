// 客室案内（/r）のトップに出す食事時間・貸切風呂の予約（2026-10-09）。
// 過ぎた予定だけを隠す。まだ来ていない予定は、今日の分も翌日以降の分も出す（当日 7時なら、その日の朝食も
// 決まっていれば翌朝の朝食も出る）。連泊で日付が変わると、前の日の予定は時間が過ぎた分から消えていく。
// 過ぎたかどうか: 終わりの時刻（貸切風呂は枠の終わり、食事は始まりから MEAL_GRACE_MIN 分後）を過ぎたら隠す。
// 日をまたいで並ぶときは、日ごとにまとめて最初の日だけ開く（groupByDay・+page.svelte）。

/** 食事は始まりから何分たったら「過ぎた」とするか（食事中は出しておく） */
export const MEAL_GRACE_MIN = 60;

/** 日本時間の YYYY-MM-DD */
export function jstDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

const pad = (hm: string) => (/^\d:\d{2}$/.test(hm) ? `0${hm}` : hm);

/** 日本時間の日付と 'HH:MM' → 時刻（ms） */
export function jstTime(date: string, hm: string): number {
  return Date.parse(`${date}T${pad(hm)}:00+09:00`);
}

/** まだ過ぎていない予定か。end を省くと start から graceMin 分後を終わりとみなす */
export function isUpcoming(
  item: { date: string; start: string; end?: string | null },
  now: Date = new Date(),
  graceMin = MEAL_GRACE_MIN
): boolean {
  const start = jstTime(item.date, item.start);
  if (!Number.isFinite(start)) return false;
  let end = item.end ? jstTime(item.date, item.end) : start + graceMin * 60_000;
  // 終わりが始まりより前（0時またぎの枠）なら翌日の時刻
  if (Number.isFinite(end) && end <= start) end += 24 * 3600_000;
  return now.getTime() < (Number.isFinite(end) ? end : start);
}

/** 過ぎていない予定だけに絞る */
export function upcomingItems<T>(
  items: T[],
  pick: (item: T) => { date: string; start: string; end?: string | null },
  now: Date = new Date(),
  graceMin = MEAL_GRACE_MIN
): T[] {
  return items.filter((item) => isUpcoming(pick(item), now, graceMin));
}

/** 日ごとにまとめる（日付順・各日の中は元の並び） */
export function groupByDay<T extends { date: string }>(items: T[]): { date: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of [...items].sort((a, b) => a.date.localeCompare(b.date))) {
    const list = map.get(item.date) ?? [];
    list.push(item);
    map.set(item.date, list);
  }
  return [...map].map(([date, list]) => ({ date, items: list }));
}
