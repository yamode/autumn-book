import { error, fail, redirect } from '@sveltejs/kit';
import { readForumInbox, readForumNotice } from '$lib/server/forum-activity';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (event.locals.user?.role !== 'member') redirect(303, '/auth/login?next=%2Faccount%2Fcommunity%2Fnotifications');
	if (!FORUM_WRITE_ENABLED) return { notices: [], enabled: false };
	event.setHeaders({ 'cache-control': 'private, no-store' });
	const notices = await readForumInbox(event).catch(() => error(503, m.forum_notifications_load_error()));
	return { notices, enabled: true };
};

export const actions: Actions = {
	open: async (event) => {
		if (!FORUM_WRITE_ENABLED || event.locals.user?.role !== 'member') return fail(403, { message: m.forum_cta_login_to_post() });
		const id = String((await event.request.formData()).get('id') ?? '');
		if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return fail(400, { message: m.forum_error_invalid_input() });
		const target = await readForumNotice(event, id, null).catch(() => undefined);
		if (target === undefined) return fail(503, { message: m.forum_notifications_load_error() });
		if (!target) return fail(404, { message: m.forum_notification_unavailable() });
		redirect(303, `/community/threads/${encodeURIComponent(target.thread_id)}#post-${target.post_no}`);
	},
	markAll: async (event) => {
		if (!FORUM_WRITE_ENABLED || event.locals.user?.role !== 'member') return fail(403, { message: m.forum_cta_login_to_post() });
		const through = String((await event.request.formData()).get('through') ?? '');
		if (!through || !Number.isFinite(Date.parse(through))) return fail(400, { message: m.forum_error_invalid_input() });
		try {
			await readForumNotice(event, null, through);
		} catch {
			return fail(503, { message: m.forum_notifications_load_error() });
		}
		return { marked: true };
	}
};
