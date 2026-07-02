import { error } from '@sveltejs/kit';
import { getFacilityBySlug, getNews } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { listNews, FACILITY_UUID } from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');

	if (DATA_SOURCE === 'supabase' && FACILITY_UUID[facility.id]) {
		const rows = await listNews(FACILITY_UUID[facility.id]);
		const news = rows.map((r) => ({
			id: r.id,
			facilityId: facility.id,
			title: r.title,
			body: r.body ?? '',
			publishedAt: r.published_at,
			isPublished: true,
			createdAt: r.published_at
		}));
		return { facility, news };
	}

	return { facility, news: getNews(facility.id, locale) };
};
