import { error } from '@sveltejs/kit';
import { getForumBoard, listForumThreads, getForumProfile, getPublishedFacilities } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { getForumBoardData, listForumThreadsData } from '$lib/server/supabase-data';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

const PER_PAGE = 20;

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);

	const supabase = DATA_SOURCE === 'supabase';
	const board = supabase ? await getForumBoardData(params.board) : getForumBoard(params.board);
	if (!board) error(404, 'Board not found');

	const { threads, total } = supabase
		? await listForumThreadsData(board.slug, page, PER_PAGE)
		: listForumThreads(board.id, page, PER_PAGE);
	const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

	const facilities = getPublishedFacilities(getLocale()).map((f) => ({ name: f.name, brandSlug: f.brandSlug, slug: f.slug }));
	// supabase モードは Supabase Auth 未接続でニックネーム状態を判定できない（書き込みは gate 済み）
	const hasNickname = supabase ? false : locals.user ? !!getForumProfile(locals.user.id) : false;

	return {
		board: { slug: board.slug, title: board.title, description: board.description, isArchived: board.isArchived },
		threads,
		page,
		totalPages,
		facilities,
		isLoggedIn: !!locals.user,
		hasNickname,
		writeEnabled: FORUM_WRITE_ENABLED
	};
};
