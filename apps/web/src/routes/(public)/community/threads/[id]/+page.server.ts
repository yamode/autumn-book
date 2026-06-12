import { error, fail, redirect } from '@sveltejs/kit';
import { getForumThread, listForumPosts, getForumProfile, createForumPost, deleteForumPost, getPublishedFacilities } from '$lib/server/store';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const thread = getForumThread(params.id);
	if (!thread) error(404, 'Thread not found');

	const posts = listForumPosts(thread.id, locals.user?.id);
	const facilities = getPublishedFacilities(getLocale()).map((f) => ({ name: f.name, brandSlug: f.brandSlug, slug: f.slug }));
	const hasNickname = locals.user ? !!getForumProfile(locals.user.id) : false;

	return {
		thread: {
			id: thread.id,
			title: thread.title,
			isLocked: thread.isLocked,
			isPinned: thread.isPinned,
			boardSlug: thread.boardSlug,
			boardTitle: thread.boardTitle
		},
		posts,
		facilities,
		isLoggedIn: !!locals.user,
		hasNickname
	};
};

export const actions: Actions = {
	reply: async ({ request, params, locals, url }) => {
		if (!locals.user) redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname)}`);
		// ニックネーム未設定なら設定へ
		if (!getForumProfile(locals.user.id)) redirect(303, `/community/settings?next=${encodeURIComponent(url.pathname)}`);

		const form = await request.formData();
		const body = String(form.get('body') ?? '');
		const res = createForumPost(locals.user.id, params.id, body);
		if ('error' in res) {
			const message =
				res.error === 'banned' ? m.forum_error_banned()
				: res.error === 'locked' ? m.forum_error_locked()
				: res.error === 'no_nickname' ? m.forum_nickname_required_notice()
				: res.error === 'not_found' ? m.forum_error_not_found()
				: m.forum_error_invalid_input();
			return fail(400, { message, body });
		}
		// 自分の投稿アンカーへ
		redirect(303, `/community/threads/${params.id}#post-${res.post.postNo}`);
	},

	deletePost: async ({ request, params, locals }) => {
		if (!locals.user) return fail(401, { message: m.forum_cta_login_to_post() });
		const form = await request.formData();
		const postId = String(form.get('postId') ?? '');
		// 本人削除（byStaff=false）。staff/admin の他人投稿削除は管理画面で行う
		const res = deleteForumPost(postId, locals.user.id, false);
		if (res !== true) {
			return fail(400, { message: m.forum_error_not_found() });
		}
		redirect(303, `/community/threads/${params.id}`);
	}
};
