// 出張シェフ（hp-pchef）の管理画面で使う表示用の値と計算（サーバー・画面の両方から使う）。
// DB の正本は autumn-shared 20261123043915_chef_private_chef_reservations.sql（chef スキーマ）と 20261123045740_chef_payment_guards.sql（決済の守り）。
// 設計: yamode/hp-pchef docs/design.md 5章「山人の流れ」

export type ChefStatus = 'requested' | 'confirmed' | 'paid' | 'declined' | 'cancelled';

export const CHEF_STATUS_LABEL: Record<ChefStatus, string> = {
	requested: '仮予約',
	confirmed: '確定',
	paid: '支払い済み',
	declined: 'お断り',
	cancelled: '取消'
};

export const CHEF_STYLE_LABEL: Record<string, string> = { hors_doeuvre: 'オードブル', course: 'コース' };
export const CHEF_AREA_LABEL: Record<string, string> = { nishiwaga: '西和賀町', kitakami: '北上市' };
export const CHEF_PAYMENT_LABEL: Record<string, string> = { online: 'オンライン決済', onsite: '当日現地払い' };

/** 生きている予約（枠をふさぐ状態）。DB の部分一意索引 reservations_one_live_per_slot と同じ */
export const CHEF_LIVE_STATUSES: ChefStatus[] = ['requested', 'confirmed', 'paid'];

/** 仮予約のまま何日たったら一覧で目立たせるか（設計書 5章の「仮：3日」） */
export const CHEF_STALE_DAYS = 3;

/** 日本時間の今日（YYYY-MM-DD） */
export function jstToday(now: Date = new Date()): string {
	return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD 同士の日数差（to - from） */
export function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400_000);
}

/** YYYY-MM-DD に日数を足す */
export function addDays(date: string, days: number): string {
	return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400_000).toISOString().slice(0, 10);
}

/**
 * キャンセル料率（設計書 1章）：5日前まで0%／4〜2日前25%／前日50%／当日（と過ぎた日）100%。
 * daysBefore は「利用日 - 今日（日本時間）」。
 */
export function chefCancelRate(daysBefore: number): number {
	if (daysBefore >= 5) return 0;
	if (daysBefore >= 2) return 0.25;
	if (daysBefore === 1) return 0.5;
	return 1;
}

/** キャンセル料の目安（税込総額 × 料率・円未満切り捨て） */
export function chefCancelFee(amountTotal: number, date: string, today: string = jstToday()): { daysBefore: number; rate: number; fee: number } {
	const daysBefore = daysBetween(today, date);
	const rate = chefCancelRate(daysBefore);
	return { daysBefore, rate, fee: Math.floor(amountTotal * rate) };
}

/** 仮予約のまま CHEF_STALE_DAYS 日以上たったか */
export function chefIsStale(status: string, createdAt: string, now: Date = new Date()): boolean {
	return status === 'requested' && now.getTime() - Date.parse(createdAt) >= CHEF_STALE_DAYS * 86400_000;
}

/** 人数の表示（おとな2名・小学生1名・小学生未満1名） */
export function chefPartyLabel(r: { adults: number; children: number; infants: number }): string {
	const parts = [`おとな${r.adults}名`];
	if (r.children) parts.push(`小学生${r.children}名`);
	if (r.infants) parts.push(`小学生未満${r.infants}名`);
	return `${parts.join('・')}（計${r.adults + r.children + r.infants}名）`;
}

/** 日付の表示（2026年12月5日（土）） */
export function chefDateLabel(date: string): string {
	const d = new Date(date + 'T00:00:00Z');
	const w = '日月火水木金土'[d.getUTCDay()];
	return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${w}）`;
}

/** 時刻の表示（18:00:00 → 18:00） */
export function chefTimeLabel(time: string): string {
	return (time ?? '').slice(0, 5);
}

export const yen = (n: number | null | undefined) => `${Math.round(Number(n ?? 0)).toLocaleString('ja-JP')}円`;

/** オンライン決済の期限（利用日の3日前）。DB の chef.checkout_prepare・admin_reservation_action と同じ */
export const CHEF_PAY_DEADLINE_DAYS = 3;
export const CHEF_PAY_DEADLINE_MESSAGE =
	'オンライン決済の期限（利用日の3日前）を過ぎています。現地払いに切り替えてから確定するか、お断りしてください。';

/** オンライン決済の期限日（YYYY-MM-DD） */
export function chefPayDeadline(date: string): string {
	return addDays(date, -CHEF_PAY_DEADLINE_DAYS);
}

/**
 * オンライン決済の期限を過ぎたか（＝このままでは確定できない）。
 * DB の判定 `(now() at time zone 'Asia/Tokyo')::date > date - 3` に合わせ、期限日の当日まではまだ間に合う扱い。
 */
export function chefPayDeadlinePassed(r: { date: string; payment_method: string }, today: string = jstToday()): boolean {
	return r.payment_method === 'online' && today > chefPayDeadline(r.date);
}

/** YYYY-MM-DD の形で、かつ実在する日付か（2026-02-31 などは false） */
export function isValidIsoDate(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const t = Date.parse(s + 'T00:00:00Z');
	return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/**
 * 開いている枠（status=open）とシフトの「休み」が重なっている枠を返す（今日以降だけ）。
 * shifts のキーは `${シェフのID}|${日付}`。
 */
export function chefOpenSlotsOnDayOff<S extends { chef_staff_id: string; date: string; status: string }>(
	slots: S[],
	shifts: Record<string, { kind: string } | undefined>,
	today: string = jstToday()
): S[] {
	return slots.filter((s) => s.status === 'open' && s.date >= today && shifts[`${s.chef_staff_id}|${s.date}`]?.kind === 'off');
}
