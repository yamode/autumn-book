import type { Facility, RoomType, RatePlan, Faq, CalendarDay, NewsPost } from '$lib/types';
import type { CalendarMonthRange } from '$lib/calendar-range';

/** 施設HPテンプレートに渡すページデータ（+page.server.ts の load 結果） */
export interface FacilityPageData {
	facility: Facility;
	rooms: RoomType[];
	plans: RatePlan[];
	facilityFaqs: Faq[];
	calendar: CalendarDay[];
	calMonth: string;
	calendarNav: CalendarMonthRange;
	news: NewsPost[];
}
