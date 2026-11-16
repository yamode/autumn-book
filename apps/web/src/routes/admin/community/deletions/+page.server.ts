import { error } from '@sveltejs/kit';
import { DELETED_POSTS_PAGE_SIZE, readDeletedForumPosts } from '$lib/server/forum-activity';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const role = event.locals.user?.role;
	if (role !== 'admin' && role !== 'staff') error(403, '削除済み投稿の確認には運営権限が必要です。');
	event.setHeaders({ 'cache-control': 'private, no-store' });
	const rawPage = Number(event.url.searchParams.get('page'));
	const page = Number.isSafeInteger(rawPage) ? Math.min(1000, Math.max(1, rawPage)) : 1;
	try {
		const { posts, total } = await readDeletedForumPosts(event, page);
		return { posts, page, hasNext: page < 1000 && page * DELETED_POSTS_PAGE_SIZE < total, loadError: false };
	} catch {
		return { posts: [], page, hasNext: false, loadError: true };
	}
};
