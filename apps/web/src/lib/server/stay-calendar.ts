// 泊数込みの空室カレンダー（チェックイン日ごとの最安「1名1泊」と残室）。
// 施設全体（プラン未指定）とプラン詳細の両方で使い、日付ピッカーで泊数を変えたときは /api/stay-calendar から取り直す。
import { addDays, eachNight } from '@autumn-book/core';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityStayCalendar } from '$lib/server/supabase-data';
import { quoteFor, ratePlans, remainingRooms, roomTypes } from '$lib/server/store';

export type StayCalendarDay = { date: string; price: number; remaining: number };

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
		for (const pair of pairs) {
			const left = Math.min(...eachNight(date, nights).map((night) => remainingRooms(pair.roomTypeId, night)));
			if (left <= 0) continue;
			remaining = Math.max(remaining, left);
			const perPerson = Math.round(quoteFor(pair.planId, pair.roomTypeId, date, nights, adults, 0).total / (adults * nights));
			if (price === null || perPerson < price) price = perPerson;
		}
		if (price !== null) days.push({ date, price, remaining });
	}
	return days;
}

export async function stayCalendar(
	facilityId: string,
	nights: number,
	adults: number,
	options: { planId?: string; roomTypeId?: string; months?: number } = {}
): Promise<{ days: StayCalendarDay[]; through: string }> {
	const months = Math.min(6, Math.max(1, options.months ?? 2));
	const through = monthsAfter(todayJst(), months);
	if (DATA_SOURCE === 'supabase') {
		return { days: await sbFacilityStayCalendar(facilityId, nights, adults, { planId: options.planId, roomTypeId: options.roomTypeId, months }), through };
	}
	return { days: demoStayCalendar(facilityId, nights, adults, options.planId, options.roomTypeId, through), through };
}
