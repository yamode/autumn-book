import { error } from '@sveltejs/kit';
import { getFacilityBySlug, getRoomTypes, getRatePlans } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityBySlug, sbRoomTypeBySlug, sbListPlansMapped } from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	if (DATA_SOURCE === 'supabase') {
		const facility = await sbFacilityBySlug(params.facility);
		if (!facility || facility.brandSlug !== params.brand) error(404, '施設が見つかりません');
		const room = await sbRoomTypeBySlug(facility.id, params.room);
		if (!room) error(404, '客室が見つかりません');
		// 実データではプラン⇄客室の関係は日付付き plan_offers が返す。日付なしの一覧では確定できないため、
		// 施設の全公開プランを提示する（実際の可否は各プラン詳細の plan_offers で判定される）。
		const plans = await sbListPlansMapped(facility.id);
		return { facility, room, plans };
	}

	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');
	const room = getRoomTypes(facility.id, locale).find((r) => r.slug === params.room);
	if (!room) error(404, '客室が見つかりません');
	const plans = getRatePlans(facility.id, locale).filter((p) => p.roomTypeIds.includes(room.id));
	return { facility, room, plans };
};
