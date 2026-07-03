import { error, fail, redirect } from '@sveltejs/kit';
import { getForumBoard, getForumProfile, createForumThread } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { getForumBoardData } from '$lib/server/supabase-data';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const board = DATA_SOURCE === 'supabase' ? await getForumBoardData(params.board) : getForumBoard(params.board);
	if (!board) error(404, 'Board not found');

	// 書き込み不可モード（supabase・P5 まで）: リダイレクトせず案内を表示（ページ側で writeEnabled を見る）
	if (!FORUM_WRITE_ENABLED) {
		return { board: { slug: board.slug, title: board.title }, writeEnabled: false };
	}

	// 未ログインはログインへ（書き込みガード・設計書 §6）
	if (!locals.user) redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname)}`);

	// アーカイブ板では新規スレ不可
	if (board.isArchived) redirect(303, `/community/${board.slug}`);

	// ニックネーム未設定なら設定ページへ（戻り先付き）
	const hasNickname = !!getForumProfile(locals.user.id);
	if (!hasNickname) redirect(303, `/community/settings?next=${encodeURIComponent(url.pathname)}`);

	return { board: { slug: board.slug, title: board.title }, writeEnabled: true };
};

export const actions: Actions = {
	create: async ({ request, params, locals, url }) => {
		if (!FORUM_WRITE_ENABLED) return fail(403, { message: m.forum_write_app_only(), title: '', body: '' });
		if (!locals.user) redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname)}`);
		const form = await request.formData();
		const title = String(form.get('title') ?? '');
		const body = String(form.get('body') ?? '');

		const board = getForumBoard(params.board);
		if (!board) return fail(404, { message: m.forum_error_not_found(), title, body });

		const res = createForumThread(locals.user.id, board.id, title, body);
		if ('error' in res) {
			const message =
				res.error === 'banned' ? m.forum_error_banned()
				: res.error === 'no_nickname' ? m.forum_nickname_required_notice()
				: res.error === 'archived' ? m.forum_error_archived()
				: m.forum_error_invalid_input();
			return fail(400, { message, title, body });
		}
		redirect(303, `/community/threads/${res.thread.id}`);
	}
};
