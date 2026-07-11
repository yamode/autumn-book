import { listForumBoards, listForumThreads, getPublishedFacilities } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { listForumBoardsData, listForumThreadsData } from '$lib/server/supabase-data';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

const RECENT_THREADS_LIMIT = 10;
const PER_BOARD_SAMPLE = 5;

export const load: PageServerLoad = async ({ locals }) => {
	const boards = DATA_SOURCE === 'supabase' ? await listForumBoardsData() : listForumBoards();

	// 掲示板横断の「最近の投稿」= 各板の最新数件を集めて日時でマージ（専用RPC無しで両データソース対応）
	const perBoard = await Promise.all(
		boards.map(async (board) => {
			const { threads } =
				DATA_SOURCE === 'supabase'
					? await listForumThreadsData(board.slug, 1, PER_BOARD_SAMPLE)
					: listForumThreads(board.id, 1, PER_BOARD_SAMPLE);
			return threads.map((t) => ({ ...t, boardSlug: board.slug, boardTitle: board.title }));
		})
	);
	const recentThreads = perBoard
		.flat()
		.sort((a, b) => b.lastPostedAt.localeCompare(a.lastPostedAt))
		.slice(0, RECENT_THREADS_LIMIT);

	const facilities = getPublishedFacilities(getLocale()).map((f) => ({ name: f.name, brandSlug: f.brandSlug, slug: f.slug }));
	return { boards, recentThreads, facilities, isLoggedIn: !!locals.user, writeEnabled: FORUM_WRITE_ENABLED };
};
