import { DATA_SOURCE } from '$lib/server/supabase';
import { forumUnreadCount } from '$lib/server/forum-activity';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { memberPagesFor } from '$lib/server/partners/store';
import { memberPageCalendarHrefOf } from '$lib/partner-member-page';
import type { LayoutServerLoad } from './$types';

/**
 * プライベートブック（VIP＝特別会員の専用の予約・2026-11-27）の入口。メインメニューの「PRIVATE BOOK」の行き先。
 * 本人のページを先に、無ければご家族のご招待のページ。会員でない・ページが無い・読めないときは null（ボタンを出さない）
 */
async function privateBookHref(userId: string): Promise<string | null> {
	const sb = partnerServiceClient();
	if (!sb) return null;
	const pages = await memberPagesFor(sb, userId).catch(() => []);
	const page = pages.find((p) => p.via === 'self') ?? pages[0];
	return page?.urlToken ? memberPageCalendarHrefOf(page.urlToken) : null;
}

export const load: LayoutServerLoad = async (event) => {
	event.depends('book:forum-notifications');
	const user = event.locals.user;
	const isMember = user?.role === 'member';
	const [forumUnread, privateBook] = await Promise.all([
		isMember && FORUM_WRITE_ENABLED ? forumUnreadCount(event).catch(() => 0) : Promise.resolve(0),
		isMember && user?.id && DATA_SOURCE === 'supabase' ? privateBookHref(user.id).catch(() => null) : Promise.resolve(null)
	]);
	return { user, demoData: DATA_SOURCE !== 'supabase', forumUnread, privateBookHref: privateBook };
};
