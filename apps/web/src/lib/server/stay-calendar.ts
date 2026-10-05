// 泊数込みの空室カレンダー（チェックイン日ごとの最安「1名1泊」と残室）。
// 施設全体（プラン未指定）とプラン詳細の両方で使い、日付ピッカーで泊数を変えたときは /api/stay-calendar から取り直す。
import { addDays, eachNight } from '@autumn-book/core';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityStayCalendar } from '$lib/server/supabase-data';
import { quoteFor, ratePlans, remainingRooms, roomTypes, searchAvailability } from '$lib/server/store';

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

function demoStayCalendar(facilityId: string, nights: number, adults: number, planId: string | undefined, through: string) {
	const days: StayCalendarDay[] = [];
	const plan = planId ? ratePlans.find((item) => item.id === planId) : undefined;
	for (let date = todayJst(); date <= through; date = addDays(date, 1)) {
		if (!plan) {
			const result = searchAvailability({ checkin: date, nights, adults, children: 0 }).find((item) => item.facility.id === facilityId);
			if (result?.minTotal && result.remaining > 0) days.push({ date, price: Math.round(result.minTotal / (adults * nights)), remaining: result.remaining });
			continue;
		}
		let best = null as StayCalendarDay | null;
		for (const roomTypeId of plan.roomTypeIds) {
			const room = roomTypes.find((item) => item.id === roomTypeId);
			if (!room || room.capacity < adults) continue;
			const remaining = Math.min(...eachNight(date, nights).map((night) => remainingRooms(roomTypeId, night)));
			if (remaining <= 0) continue;
			const price = Math.round(quoteFor(plan.id, roomTypeId, date, nights, adults, 0).total / (adults * nights));
			if (!best || price < best.price) best = { date, price, remaining: Math.max(remaining, best?.remaining ?? 0) };
		}
		if (best) days.push(best);
	}
	return days;
}

export async function stayCalendar(
	facilityId: string,
	nights: number,
	adults: number,
	options: { planId?: string; months?: number } = {}
): Promise<{ days: StayCalendarDay[]; through: string }> {
	const months = Math.min(6, Math.max(1, options.months ?? 2));
	const through = monthsAfter(todayJst(), months);
	if (DATA_SOURCE === 'supabase') {
		return { days: await sbFacilityStayCalendar(facilityId, nights, adults, { planId: options.planId, months }), through };
	}
	return { days: demoStayCalendar(facilityId, nights, adults, options.planId, through), through };
}
