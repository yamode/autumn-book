import { listForumBoards, getPublishedFacilities } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { listForumBoardsData, listRecentForumThreads } from '$lib/server/supabase-data';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

import { listRecentDemoThreads } from '$lib/server/forum-activity';

export const load: PageServerLoad = async ({ locals }) => {
	const [boards, recentThreads] = await Promise.all([
		DATA_SOURCE === 'supabase' ? listForumBoardsData() : listForumBoards(),
		DATA_SOURCE === 'supabase' ? listRecentForumThreads() : listRecentDemoThreads()
	]);

	const facilities = getPublishedFacilities(getLocale()).map((f) => ({ name: f.name, brandSlug: f.brandSlug, slug: f.slug }));
	return { boards, recentThreads, facilities, isLoggedIn: locals.user?.role === 'member', writeEnabled: FORUM_WRITE_ENABLED };
};
