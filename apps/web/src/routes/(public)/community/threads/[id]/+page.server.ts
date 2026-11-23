import { error, fail, redirect } from '@sveltejs/kit';
import { getForumThread, listForumPosts, getForumProfile, createForumPost, deleteForumPost, getPublishedFacilities } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import {
	getForumThreadData,
	listForumPostsData,
	getForumNickname,
	createForumPost as sbCreateForumPost,
	deleteOwnForumPost as sbDeleteOwnForumPost
} from '$lib/server/supabase-data';
import { notifyDemoForumReply, reportForumPost, REPORT_REASONS, type ForumReportReason } from '$lib/server/forum-activity';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import { viewerOf } from '$lib/server/secret-plans';
import { canWriteForum } from '$lib/member-benefits';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { params, locals } = event;
	const supabase = DATA_SOURCE === 'supabase';
	const thread = supabase ? await getForumThreadData(params.id) : getForumThread(params.id);
	if (!thread) error(404, 'Thread not found');

	const member = locals.user?.role === 'member' ? locals.user : null;
	const client = member && MEMBER_SUPABASE ? createSupabaseServerClient(event) : undefined;
	const [posts, hasNickname, rankOk] = await Promise.all([
		supabase ? listForumPostsData(thread.id, client) : listForumPosts(thread.id, member?.id),
		client ? getForumNickname(client).then(Boolean).catch(() => false) : Boolean(member && getForumProfile(member.id)),
		member ? viewerOf(locals).then(canWriteForum) : Promise.resolve(false)
	]);
	const facilities = getPublishedFacilities(getLocale()).map((f) => ({ name: f.name, brandSlug: f.brandSlug, slug: f.slug }));

	return {
		thread: {
			id: thread.id,
			title: thread.title,
			isLocked: thread.isLocked,
			isPinned: thread.isPinned,
			boardSlug: thread.boardSlug,
			boardTitle: thread.boardTitle,
			createdAt: thread.createdAt,
			lastPostedAt: thread.lastPostedAt
		},
		posts,
		facilities,
		isLoggedIn: Boolean(member),
		hasNickname,
		writeEnabled: FORUM_WRITE_ENABLED,
		rankOk
	};
};

export const actions: Actions = {
	reply: async (event) => {
		const { request, params, locals, url } = event;
		// 書き込み不可モード（supabase+demo）では投稿を受け付けずアプリへ誘導
		if (!FORUM_WRITE_ENABLED) return fail(403, { message: m.forum_write_app_only(), body: '' });
		if (locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname)}`);
		// デモの未設定会員は設定へ。本接続はフォーム入力前に判定し、RPC の競合時は入力を保持する。
		if (!MEMBER_SUPABASE && !getForumProfile(locals.user.id)) {
			redirect(303, `/account/community?next=${encodeURIComponent(url.pathname)}`);
		}

		if (!canWriteForum(await viewerOf(locals))) return fail(403, { message: m.forum_rank_required_notice(), body: '' });
		const form = await request.formData();
		const body = String(form.get('body') ?? '');

		if (MEMBER_SUPABASE) {
			let postNo: number;
			try {
				const res = await sbCreateForumPost(createSupabaseServerClient(event), params.id, body);
				postNo = res.post_no;
			} catch (e) {
				const msg = String((e as { message?: unknown } | null)?.message ?? '');
				if (msg.includes('no_nickname')) return fail(400, { message: m.forum_nickname_required_notice(), body });
				if (msg.includes('rate_limited')) return fail(429, { message: m.forum_error_rate_limit(), body });
				if (msg.includes('rank_required')) return fail(403, { message: m.forum_rank_required_notice(), body });
				const message =
					msg.includes('banned') ? m.forum_error_banned()
					: msg.includes('thread_locked') ? m.forum_error_locked()
					: msg.includes('not_found') ? m.forum_error_not_found()
					: m.forum_error_invalid_input();
				return fail(400, { message, body });
			}
			redirect(303, `/community/threads/${params.id}#post-${postNo}`);
		}

		const res = createForumPost(locals.user.id, params.id, body);
		if ('error' in res) {
			const message =
				res.error === 'banned' ? m.forum_error_banned()
				: res.error === 'locked' ? m.forum_error_locked()
				: res.error === 'rank_required' ? m.forum_rank_required_notice()
				: res.error === 'no_nickname' ? m.forum_nickname_required_notice()
				: res.error === 'not_found' ? m.forum_error_not_found()
				: m.forum_error_invalid_input();
			return fail(400, { message, body });
		}
		notifyDemoForumReply(res.post.id);
		// 自分の投稿アンカーへ
		redirect(303, `/community/threads/${params.id}#post-${res.post.postNo}`);
	},

	report: async (event) => {
		if (!FORUM_WRITE_ENABLED || event.locals.user?.role !== 'member') return fail(403, { reportError: m.forum_cta_login_to_post() });
		const form = await event.request.formData();
		const postId = String(form.get('postId') ?? '');
		const reason = String(form.get('reason') ?? '') as ForumReportReason;
		const note = String(form.get('note') ?? '').trim();
		if (!REPORT_REASONS.includes(reason) || note.length > 500) {
			return fail(400, { reportPostId: postId, reportError: m.forum_report_invalid(), reportReason: reason, reportNote: note });
		}
		try {
			await reportForumPost(event, event.params.id, postId, reason, note);
		} catch (cause) {
			const msg = cause instanceof Error ? cause.message : '';
			const reportError = msg.includes('rate_limited') ? m.forum_report_rate_limited()
				: msg.includes('not_found') ? m.forum_notification_unavailable() : m.forum_report_failed();
			return fail(msg.includes('rate_limited') ? 429 : 400, { reportPostId: postId, reportError, reportReason: reason, reportNote: note });
		}
		return { reportPostId: postId, reportSuccess: true, reportReason: undefined, reportNote: undefined };
	},
	deletePost: async (event) => {
		const { request, params, locals } = event;
		if (!FORUM_WRITE_ENABLED) return fail(403, { message: m.forum_write_app_only() });
		if (locals.user?.role !== 'member') return fail(401, { message: m.forum_cta_login_to_post() });
		const form = await request.formData();
		const postId = String(form.get('postId') ?? '');

		if (MEMBER_SUPABASE) {
			try {
				await sbDeleteOwnForumPost(createSupabaseServerClient(event), postId);
			} catch {
				return fail(400, { message: m.forum_error_not_found() });
			}
			redirect(303, `/community/threads/${params.id}`);
		}

		// 本人削除（byStaff=false）。staff/admin の他人投稿削除は管理画面で行う
		const res = deleteForumPost(postId, locals.user.id, false);
		if (res !== true) {
			return fail(400, { message: m.forum_error_not_found() });
		}
		redirect(303, `/community/threads/${params.id}`);
	}
};
