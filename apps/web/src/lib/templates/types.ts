import type { Facility, RoomType, RatePlan, Faq, CalendarDay, NewsPost } from '$lib/types';

/** 施設HPテンプレートに渡すページデータ（+page.server.ts の load 結果） */
export interface FacilityPageData {
	facility: Facility;
	rooms: RoomType[];
	plans: RatePlan[];
	facilityFaqs: Faq[];
	calendar: CalendarDay[];
	calMonth: string;
	news: NewsPost[];
}
