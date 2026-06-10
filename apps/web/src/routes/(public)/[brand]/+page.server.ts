import { error } from '@sveltejs/kit';
import { brands, facilities } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const brand = brands.find((b) => b.slug === params.brand);
	if (!brand) error(404, 'ブランドが見つかりません');
	return { brand, facilities: facilities.filter((f) => f.brandSlug === brand.slug && f.isPublished) };
};
