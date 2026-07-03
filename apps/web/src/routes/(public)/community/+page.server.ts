import { listForumBoards, getPublishedFacilities } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { listForumBoardsData } from '$lib/server/supabase-data';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const boards = DATA_SOURCE === 'supabase' ? await listForumBoardsData() : listForumBoards();
	const facilities = getPublishedFacilities(getLocale()).map((f) => ({ name: f.name, brandSlug: f.brandSlug, slug: f.slug }));
	return { boards, facilities, isLoggedIn: !!locals.user, writeEnabled: FORUM_WRITE_ENABLED };
};
