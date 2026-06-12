import { listForumBoards, getPublishedFacilities } from '$lib/server/store';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const boards = listForumBoards();
	const facilities = getPublishedFacilities(getLocale()).map((f) => ({ name: f.name, brandSlug: f.brandSlug, slug: f.slug }));
	return { boards, facilities, isLoggedIn: !!locals.user };
};
