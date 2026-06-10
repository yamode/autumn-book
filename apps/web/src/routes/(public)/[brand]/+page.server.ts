import { error } from '@sveltejs/kit';
import { brands, getPublishedFacilities } from '$lib/server/store';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const locale = getLocale();
	const brand = brands.find((b) => b.slug === params.brand);
	if (!brand) error(404, 'ブランドが見つかりません');
	return {
		brand,
		facilities: getPublishedFacilities(locale).filter((f) => f.brandSlug === brand.slug)
	};
};
