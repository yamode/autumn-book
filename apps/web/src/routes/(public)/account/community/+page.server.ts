import { fail, redirect } from '@sveltejs/kit';
import { getForumProfile, setForumNickname } from '$lib/server/store';
import { setForumNickname as sbSetForumNickname, getForumNickname as sbGetForumNickname } from '$lib/server/supabase-data';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import { readForumInbox, readForumNotice } from '$lib/server/forum-activity';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import * as m from '$lib/paraglide/messages';
import { safeNext } from '$lib/safe-next';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { locals, url } = event;
	if (locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	if (!FORUM_WRITE_ENABLED) {
		return { nickname: '', next: '', writeEnabled: false, notices: [], inboxFailed: false };
	}
	event.setHeaders({ 'cache-control': 'private, no-store' });
	event.depends('book:forum-notifications');
	const [nickname, notices] = await Promise.all([
		MEMBER_SUPABASE
			? sbGetForumNickname(createSupabaseServerClient(event)).catch(() => '')
			: getForumProfile(locals.user.id)?.nickname ?? '',
		readForumInbox(event).catch(() => null)
	]);
	return {
		nickname,
		next: safeNext(url.searchParams.get('next'), ''),
		writeEnabled: true,
		notices: notices ?? [],
		inboxFailed: notices === null
	};
};

export const actions: Actions = {
	save: async (event) => {
		const { request, locals, url } = event;
		if (!FORUM_WRITE_ENABLED) return fail(403, { message: m.forum_write_app_only() });
		if (locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(url.pathname)}`);
		const form = await request.formData();
		const nickname = String(form.get('nickname') ?? '');
		const next = String(form.get('next') ?? '');

		let savedNickname: string;
		if (MEMBER_SUPABASE) {
			try {
				const res = await sbSetForumNickname(createSupabaseServerClient(event), nickname);
				savedNickname = res.nickname;
			} catch (e) {
				const msg = String((e as { message?: unknown } | null)?.message ?? '');
				if (msg.includes('rate_limited')) return fail(429, { message: m.forum_error_nickname_wait(), nickname });
				const message = msg.includes('nickname_taken')
					? m.forum_error_nickname_taken()
					: m.forum_error_nickname_invalid();
				return fail(400, { message, nickname });
			}
		} else {
			const res = setForumNickname(locals.user.id, nickname, locals.user.role);
			if ('error' in res) {
				const message = res.error === 'taken' ? m.forum_error_nickname_taken() : m.forum_error_nickname_invalid();
				return fail(400, { message, nickname });
			}
			savedNickname = res.nickname;
		}

		// 戻り先指定があればそこへ、なければ設定画面に留まり成功表示
		if (next) {
			const to = safeNext(next, '');
			if (to) redirect(303, to);
		}
		return { saved: true, nickname: savedNickname };
	},
	open: async (event) => {
		if (!FORUM_WRITE_ENABLED || event.locals.user?.role !== 'member') return fail(403, { noticeMessage: m.forum_cta_login_to_post() });
		const id = String((await event.request.formData()).get('id') ?? '');
		if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return fail(400, { noticeMessage: m.forum_error_invalid_input() });
		const target = await readForumNotice(event, id, null).catch(() => undefined);
		if (target === undefined) return fail(503, { noticeMessage: m.forum_notifications_load_error() });
		if (!target) return fail(404, { noticeMessage: m.forum_notification_unavailable() });
		redirect(303, `/community/threads/${encodeURIComponent(target.thread_id)}#post-${target.post_no}`);
	},
	markAll: async (event) => {
		if (!FORUM_WRITE_ENABLED || event.locals.user?.role !== 'member') return fail(403, { noticeMessage: m.forum_cta_login_to_post() });
		const through = String((await event.request.formData()).get('through') ?? '');
		if (!through || !Number.isFinite(Date.parse(through))) return fail(400, { noticeMessage: m.forum_error_invalid_input() });
		try {
			await readForumNotice(event, null, through);
		} catch {
			return fail(503, { noticeMessage: m.forum_notifications_load_error() });
		}
		return { marked: true };
	}
};
