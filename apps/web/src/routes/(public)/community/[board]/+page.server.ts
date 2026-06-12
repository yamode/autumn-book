import { error } from '@sveltejs/kit';
import { getForumBoard, listForumThreads, getForumProfile, getPublishedFacilities } from '$lib/server/store';
import { getLocale } from '$lib/paraglide/runtime';
import type { PageServerLoad } from './$types';

const PER_PAGE = 20;

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const board = getForumBoard(params.board);
	if (!board) error(404, 'Board not found');

	const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
	const { threads, total } = listForumThreads(board.id, page, PER_PAGE);
	const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

	const facilities = getPublishedFacilities(getLocale()).map((f) => ({ name: f.name, brandSlug: f.brandSlug, slug: f.slug }));
	const hasNickname = locals.user ? !!getForumProfile(locals.user.id) : false;

	return {
		board: { slug: board.slug, title: board.title, description: board.description, isArchived: board.isArchived },
		threads,
		page,
		totalPages,
		facilities,
		isLoggedIn: !!locals.user,
		hasNickname
	};
};
