import { DATA_SOURCE } from '$lib/server/supabase';
import { forumUnreadCount } from '$lib/server/forum-activity';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	event.depends('book:forum-notifications');
	const user = event.locals.user;
	const forumUnread = user?.role === 'member' && FORUM_WRITE_ENABLED ? await forumUnreadCount(event).catch(() => 0) : 0;
	return { user, demoData: DATA_SOURCE !== 'supabase', forumUnread };
};
