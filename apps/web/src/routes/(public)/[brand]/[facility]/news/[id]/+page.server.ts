import { error } from '@sveltejs/kit';
import { getFacilityBySlug, getNewsPost as getNewsPostDemo } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { getNewsPost, FACILITY_UUID } from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');

	if (DATA_SOURCE === 'supabase' && FACILITY_UUID[facility.id]) {
		const row = await getNewsPost(FACILITY_UUID[facility.id], params.id);
		if (!row) error(404, 'お知らせが見つかりません');
		return {
			facility,
			post: {
				id: row.id,
				facilityId: facility.id,
				title: row.title,
				body: row.body ?? '',
				publishedAt: row.published_at,
				isPublished: true,
				createdAt: row.published_at
			}
		};
	}

	const post = getNewsPostDemo(params.id, locale);
	if (!post || post.facilityId !== facility.id) error(404, 'お知らせが見つかりません');
	return { facility, post };
};
