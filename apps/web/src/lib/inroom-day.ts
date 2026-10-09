// 客室案内（/r）のトップに出す「今の滞在日」の予定（2026-10-09）。
// 連泊のお客様は、日付が変わったら新しい滞在日の食事時間・貸切風呂の予約だけを見せる。
// 出すもの: 今日（日本時間）の予定 ＋ 明日の朝（11:00 より前）の予定。夜に見ても翌朝の朝食・朝風呂が分かるように。
// 過ぎた日の予定は出さない（前の晩の夕食などは 0 時で消える）。

/** 日本時間の YYYY-MM-DD */
export function jstDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 翌朝として前の晩に見せる時刻の上限（これより前の予定） */
const NEXT_MORNING_UNTIL = '11:00';

const pad = (hm: string) => (/^\d:\d{2}$/.test(hm) ? `0${hm}` : hm);

/** 今の滞在日に見せる予定か。date は YYYY-MM-DD、time は 'HH:MM' */
export function isCurrentStayDayItem(date: string, time: string, now: Date = new Date()): boolean {
  const today = jstDate(now);
  if (date === today) return true;
  return date === addDays(today, 1) && pad(time) < NEXT_MORNING_UNTIL;
}

/** 今の滞在日の予定だけに絞る */
export function currentStayDayItems<T>(items: T[], pick: (item: T) => { date: string; time: string }, now: Date = new Date()): T[] {
  return items.filter((item) => {
    const { date, time } = pick(item);
    return isCurrentStayDayItem(date, time, now);
  });
}
