// 泊数込みの空室カレンダー（チェックイン日ごとの最安「1名1泊」と残室）。
// 施設全体（プラン未指定）とプラン詳細の両方で使い、日付ピッカーで泊数を変えたときは /api/stay-calendar から取り直す。
import { addDays, eachNight } from '@autumn-book/core';
import { DATA_SOURCE } from '$lib/server/supabase';
import { FACILITY_UUID, sbFacilityClosedDates, sbFacilityStayCalendar } from '$lib/server/supabase-data';
import { quoteFor, ratePlans, remainingRooms, roomTypes } from '$lib/server/store';

// remaining = 1 つの部屋タイプで取れる最大の室数、rooms = その日に予約できる部屋の数（部屋タイプの残りの合計＝空室数）
export type StayCalendarDay = { date: string; price: number; remaining: number; rooms: number };

/** 公開している施設（全施設まとめのカレンダーで使う） */
export const STAY_FACILITIES = ['nishiwaga', 'oga'] as const;

/** 今日（JST） */
export function todayJst(): string {
	return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** date の months か月後（月末を超える日は月末に丸める） */
export function monthsAfter(date: string, months: number): string {
	const [year, month, day] = date.split('-').map(Number);
	const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
	return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

/** デモ: 施設の公開プラン×客室の組み合わせ（プラン・部屋タイプ・人数で絞る） */
export function demoPairs(facilityId: string, adults: number, planId?: string, roomTypeId?: string) {
	const pairs: { planId: string; roomTypeId: string }[] = [];
	for (const plan of ratePlans.filter((item) => item.facilityId === facilityId && item.isPublished && (!planId || item.id === planId))) {
		for (const id of plan.roomTypeIds) {
			const room = roomTypes.find((item) => item.id === id);
			if (room && room.capacity >= adults && (!roomTypeId || id === roomTypeId)) pairs.push({ planId: plan.id, roomTypeId: id });
		}
	}
	return pairs;
}

function demoStayCalendar(facilityId: string, nights: number, adults: number, planId: string | undefined, roomTypeId: string | undefined, through: string) {
	const days: StayCalendarDay[] = [];
	const pairs = demoPairs(facilityId, adults, planId, roomTypeId);
	for (let date = todayJst(); date <= through; date = addDays(date, 1)) {
		let price: number | null = null;
		let remaining = 0;
		const perRoom = new Map<string, number>();
		for (const pair of pairs) {
			const left = Math.min(...eachNight(date, nights).map((night) => remainingRooms(pair.roomTypeId, night)));
			if (left <= 0) continue;
			remaining = Math.max(remaining, left);
			perRoom.set(pair.roomTypeId, left);
			const perPerson = Math.round(quoteFor(pair.planId, pair.roomTypeId, date, nights, adults, 0).total / (adults * nights));
			if (price === null || perPerson < price) price = perPerson;
		}
		if (price !== null) days.push({ date, price, remaining, rooms: [...perRoom.values()].reduce((s, n) => s + n, 0) });
	}
	return days;
}

/**
 * 施設の指定を ID に直す。HP 配布の検索バー（static/embed/search-bar.js）はデータ源を知らないので
 * 施設 slug（nishiwaga / oga）で呼ぶ。slug なら demo は `f-<slug>`、supabase は UUID に。ID はそのまま返す。
 */
export function resolveStayFacility(raw: string, source: 'demo' | 'supabase' = DATA_SOURCE): string {
	const demoId = `f-${raw}`;
	if (!/^[a-z]+$/.test(raw) || !Object.prototype.hasOwnProperty.call(FACILITY_UUID, demoId)) return raw;
	return source === 'supabase' ? FACILITY_UUID[demoId] : demoId;
}

/**
 * 全施設まとめ（トップなど施設を決めていない検索バー・2026-11-02）: 日ごとに最安は施設の中の最安、空室数は施設の合計。
 * 休館日はすべての施設が休館の日だけ。取れなかった施設は飛ばす（全部取れなければエラー）
 */
export async function allFacilitiesStayCalendar(nights: number, adults: number, months: number) {
	const results = await Promise.allSettled(STAY_FACILITIES.map((f) => stayCalendar(f, nights, adults, { months })));
	const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
	if (ok.length === 0) throw new Error('all_facilities_unavailable');
	const byDate = new Map<string, StayCalendarDay>();
	for (const cal of ok) {
		for (const d of cal.days) {
			const cur = byDate.get(d.date);
			byDate.set(
				d.date,
				cur ? { date: d.date, price: Math.min(cur.price, d.price), remaining: Math.max(cur.remaining, d.remaining), rooms: cur.rooms + d.rooms } : { ...d }
			);
		}
	}
	const closed = ok.length === STAY_FACILITIES.length ? ok[0].closed.filter((date) => ok.every((cal) => cal.closed.includes(date))) : [];
	return { days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), through: ok[0].through, closed };
}

export async function stayCalendar(
	rawFacilityId: string,
	nights: number,
	adults: number,
	// previewPlanId: スタッフのプレビュー中のプラン（販売中でなくても本物の空室を返す・$lib/server/plan-preview）
	options: { planId?: string; roomTypeId?: string; months?: number; previewPlanId?: string } = {}
): Promise<{ days: StayCalendarDay[]; through: string; closed: string[] }> {
	const facilityId = resolveStayFacility(rawFacilityId);
	const months = Math.min(6, Math.max(1, options.months ?? 2));
	const through = monthsAfter(todayJst(), months);
	if (DATA_SOURCE === 'supabase') {
		const [days, closed] = await Promise.all([
			sbFacilityStayCalendar(facilityId, nights, adults, { planId: options.planId, roomTypeId: options.roomTypeId, months, previewPlanId: options.previewPlanId }),
			// 休館日が取れなくてもカレンダーは出す（「満室」表示になるだけ）
			sbFacilityClosedDates(facilityId, months).catch((e) => {
				console.error('[stay-calendar] closed dates', e instanceof Error ? e.message : String(e));
				return [] as string[];
			})
		]);
		return { days, through, closed };
	}
	return { days: demoStayCalendar(facilityId, nights, adults, options.planId, options.roomTypeId, through), through, closed: [] };
}
