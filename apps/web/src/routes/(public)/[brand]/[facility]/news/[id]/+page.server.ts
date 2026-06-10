import { error } from '@sveltejs/kit';
import { getFacilityBySlug, getNewsPost } from '$lib/server/store';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');
	const post = getNewsPost(params.id, locale);
	if (!post || post.facilityId !== facility.id) error(404, 'お知らせが見つかりません');
	return { facility, post };
};
