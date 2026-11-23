import { error, fail, redirect } from '@sveltejs/kit';
import { getForumBoard, getForumProfile, createForumThread } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { getForumBoardData, getForumNickname, createForumThread as sbCreateForumThread } from '$lib/server/supabase-data';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import * as m from '$lib/paraglide/messages';
import { viewerOf } from '$lib/server/secret-plans';
import { canWriteForum } from '$lib/member-benefits';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { params, locals, url } = event;
	const board = DATA_SOURCE === 'supabase' ? await getForumBoardData(params.board) : getForumBoard(params.board);
	if (!board) error(404, 'Board not found');

	// 書き込み不可モード（supabase+demo・アプリ誘導）: リダイレクトせず案内を表示
	if (!FORUM_WRITE_ENABLED) {
		return { board: { slug: board.slug, title: board.title }, writeEnabled: false, rankOk: false };
	}

	// 未ログインはログインへ（書き込みガード・設計書 §6）
	if (locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname)}`);

	// シルバー未満は書けない（閲覧はできる）
	if (!canWriteForum(await viewerOf(locals))) {
		return { board: { slug: board.slug, title: board.title }, writeEnabled: true, rankOk: false };
	}

	// アーカイブ板では新規スレ不可
	if (board.isArchived) redirect(303, `/community/${board.slug}`);

	const nickname = MEMBER_SUPABASE
		? await getForumNickname(createSupabaseServerClient(event)).catch(() => error(503, m.forum_error_profile_load()))
		: getForumProfile(locals.user.id)?.nickname;
	if (!nickname) {
		redirect(303, `/account/community?next=${encodeURIComponent(url.pathname)}`);
	}

	return { board: { slug: board.slug, title: board.title }, writeEnabled: true, rankOk: true };
};

export const actions: Actions = {
	create: async (event) => {
		const { request, params, locals, url } = event;
		if (!FORUM_WRITE_ENABLED) return fail(403, { message: m.forum_write_app_only(), title: '', body: '' });
		if (locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname)}`);
		if (!canWriteForum(await viewerOf(locals))) return fail(403, { message: m.forum_rank_required_notice(), title: '', body: '' });
		const form = await request.formData();
		const title = String(form.get('title') ?? '');
		const body = String(form.get('body') ?? '');

		if (MEMBER_SUPABASE) {
			let threadId: string;
			try {
				const res = await sbCreateForumThread(createSupabaseServerClient(event), params.board, title, body);
				threadId = res.thread_id;
			} catch (e) {
				const msg = String((e as { message?: unknown } | null)?.message ?? '');
				if (msg.includes('no_nickname')) return fail(400, { message: m.forum_nickname_required_notice(), title, body });
				if (msg.includes('rate_limited')) return fail(429, { message: m.forum_error_rate_limit(), title, body });
				if (msg.includes('rank_required')) return fail(403, { message: m.forum_rank_required_notice(), title, body });
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
				: res.error === 'rank_required' ? m.forum_rank_required_notice()
				: m.forum_error_invalid_input();
			return fail(400, { message, title, body });
		}
		redirect(303, `/community/threads/${res.thread.id}`);
	}
};
