import { DATA_SOURCE } from '$lib/server/supabase';
import { forumUnreadCount } from '$lib/server/forum-activity';
import { FORUM_WRITE_ENABLED } from '$lib/server/forum-write-enabled';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { memberPagesFor } from '$lib/server/partners/store';
import { PB_ENTRY_PATH, PB_PRICE_DEPENDENCY } from '$lib/private-book';
import type { LayoutServerLoad } from './$types';

/**
 * プライベートブック（VIP＝特別会員と、ご招待のご家族・docs/private-book.md）の入口を出すか。
 * メインメニューの「PRIVATE BOOK」は入口 /private-book（公式サイトの中で特別料金の状態に切り替える）。
 * 会員でない・使えるページが無い・読めないときは false（ボタンを出さない）
 */
async function hasPrivateBook(userId: string): Promise<boolean> {
	const sb = partnerServiceClient();
	if (!sb) return false;
	const pages = await memberPagesFor(sb, userId).catch(() => []);
	return pages.length > 0;
}

export const load: LayoutServerLoad = async (event) => {
	event.depends(PB_PRICE_DEPENDENCY);
	event.depends('book:forum-notifications');
	const user = event.locals.user;
	const isMember = user?.role === 'member';
	// 状態のとき（hooks の resolvePrivateBook が確かめ済み）はページがあるので数え直さない
	const state = event.locals.privateBook ?? null;
	const [forumUnread, available] = await Promise.all([
		isMember && FORUM_WRITE_ENABLED ? forumUnreadCount(event).catch(() => 0) : Promise.resolve(0),
		state ? Promise.resolve(true) : isMember && user?.id && DATA_SOURCE === 'supabase' ? hasPrivateBook(user.id).catch(() => false) : Promise.resolve(false)
	]);
	return {
		user,
		demoData: DATA_SOURCE !== 'supabase',
		forumUnread,
		// 入口（押すと特別料金の状態に切り替わる・戻り先は画面側で ?back= を足す）。出さないときは null
		privateBookHref: available ? PB_ENTRY_PATH : null,
		// 状態（帯・ヘッダーの塗りつぶし・かごの保存キー）。状態でなければ null
		privateBook: state
			? { partnerId: state.partnerId, pageName: state.pageName, memberName: user?.name && user.name !== 'ゲスト' ? user.name : null, pages: state.pages }
			: null
	};
};
