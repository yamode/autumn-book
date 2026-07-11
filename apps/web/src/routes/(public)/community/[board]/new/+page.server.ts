import { error, fail, redirect } from '@sveltejs/kit';
import { getForumBoard, getForumProfile, createForumThread } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { getForumBoardData, createForumThread as sbCreateForumThread } from '$lib/server/supabase-data';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const board = DATA_SOURCE === 'supabase' ? await getForumBoardData(params.board) : getForumBoard(params.board);
	if (!board) error(404, 'Board not found');

	// 書き込み不可モード（supabase+demo・アプリ誘導）: リダイレクトせず案内を表示
	if (!FORUM_WRITE_ENABLED) {
		return { board: { slug: board.slug, title: board.title }, writeEnabled: false };
	}

	// 未ログインはログインへ（書き込みガード・設計書 §6）
	if (!locals.user) redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname)}`);

	// アーカイブ板では新規スレ不可
	if (board.isArchived) redirect(303, `/community/${board.slug}`);

	// ニックネーム未設定なら設定ページへ（戻り先付き）。
	// supabase 本接続では load から profile を引く RPC が無いため、この事前チェックは
	// create アクション側で no_nickname 例外を捕捉して誘導する（下記）。
	if (!MEMBER_SUPABASE && !getForumProfile(locals.user.id)) {
		redirect(303, `/account/community?next=${encodeURIComponent(url.pathname)}`);
	}

	return { board: { slug: board.slug, title: board.title }, writeEnabled: true };
};

export const actions: Actions = {
	create: async (event) => {
		const { request, params, locals, url } = event;
		if (!FORUM_WRITE_ENABLED) return fail(403, { message: m.forum_write_app_only(), title: '', body: '' });
		if (!locals.user) redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname)}`);
		const form = await request.formData();
		const title = String(form.get('title') ?? '');
		const body = String(form.get('body') ?? '');

		if (MEMBER_SUPABASE) {
			let threadId: string;
			try {
				const res = await sbCreateForumThread(createSupabaseServerClient(event), params.board, title, body);
				threadId = res.thread_id;
			} catch (e) {
				const msg = e instanceof Error ? e.message : '';
				// ニックネーム未設定は設定ページへ誘導（catch 内の redirect はそのまま伝播する）
				if (msg.includes('no_nickname')) redirect(303, `/account/community?next=${encodeURIComponent(url.pathname)}`);
				const message =
					msg.includes('banned') ? m.forum_error_banned()
					: msg.includes('board_archived') ? m.forum_error_archived()
					: msg.includes('not_found') ? m.forum_error_not_found()
					: m.forum_error_invalid_input();
				return fail(400, { message, title, body });
			}
			redirect(303, `/community/threads/${threadId}`);
		}

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
