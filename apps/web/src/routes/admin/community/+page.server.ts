// DATA_SOURCE=supabase 時、公開側は実データだが本画面は demo データのまま（モデレーションは P5 で Supabase 化）。
import { fail } from '@sveltejs/kit';
import {
	forumBoards,
	listForumThreadsAdmin,
	listForumPosts,
	listForumProfiles,
	upsertForumBoard,
	moderateForumThread,
	deleteForumPost,
	setForumBan,
	getForumThread,
	forumThreads
} from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const isAdmin = locals.user?.role === 'admin';

	// 板選択（スレ操作・投稿削除用）
	const selectedBoardId = url.searchParams.get('board') ?? forumBoards[0]?.id ?? '';
	const selectedThreadId = url.searchParams.get('thread') ?? '';

	const boards = [...forumBoards].sort((a, b) => a.sortOrder - b.sortOrder);
	const threads = selectedBoardId
		? listForumThreadsAdmin(selectedBoardId).map((t) => ({
			id: t.id,
			title: t.title,
			isPinned: t.isPinned,
			isLocked: t.isLocked,
			isDeleted: t.isDeleted,
			replyCount: t.replyCount
		}))
		: [];

	// 選択スレの投稿一覧（投稿削除セクション）。viewer は admin なので isOwn は無視
	const posts = selectedThreadId ? listForumPosts(selectedThreadId) : [];
	const selectedThread = selectedThreadId ? getForumThread(selectedThreadId) : undefined;

	const profiles = listForumProfiles().map((p) => ({
		userId: p.userId,
		nickname: p.nickname,
		role: p.role,
		isBanned: p.isBanned
	}));

	return {
		isAdmin,
		boards,
		selectedBoardId,
		selectedThreadId,
		selectedThreadTitle: selectedThread?.title ?? '',
		threads,
		posts,
		profiles
	};
};

export const actions: Actions = {
	// ① 板の追加・編集（admin のみ）
	upsertBoard: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '板の編集は管理者のみ可能です' });
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const slug = String(form.get('slug') ?? '').trim();
		const title = String(form.get('title') ?? '').trim();
		if (!slug || !title) return fail(400, { message: 'slug とタイトルは必須です' });
		const res = upsertForumBoard({
			id: id || undefined,
			slug,
			title,
			description: String(form.get('description') ?? ''),
			sortOrder: Number(form.get('sortOrder') ?? 0) || 0,
			isArchived: form.get('isArchived') === 'on'
		});
		if ('error' in res) return fail(400, { message: 'その slug は既に使われています' });
		return { ok: 'board' };
	},

	// ② スレの pin / lock / 削除トグル（staff 可）
	moderateThread: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin' && locals.user?.role !== 'staff') return fail(403, { message: '権限がありません' });
		const actor = locals.user.id;
		const form = await request.formData();
		const threadId = String(form.get('threadId') ?? '');
		const field = String(form.get('field') ?? '');
		const thread = forumThreads.find((t) => t.id === threadId);
		if (!thread) return fail(404, { message: 'スレッドが見つかりません' });
		const patch: { isPinned?: boolean; isLocked?: boolean; isDeleted?: boolean } = {};
		if (field === 'pin') patch.isPinned = !thread.isPinned;
		else if (field === 'lock') patch.isLocked = !thread.isLocked;
		else if (field === 'delete') patch.isDeleted = !thread.isDeleted;
		else return fail(400, { message: '不正な操作です' });
		moderateForumThread(threadId, patch, actor);
		return { ok: 'thread' };
	},

	// ③ 投稿削除（staff 可・byStaff=true で監査ログ）
	deletePost: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin' && locals.user?.role !== 'staff') return fail(403, { message: '権限がありません' });
		const actor = locals.user.id;
		const form = await request.formData();
		const postId = String(form.get('postId') ?? '');
		const res = deleteForumPost(postId, actor, true);
		if (res !== true) return fail(400, { message: '投稿を削除できませんでした' });
		return { ok: 'post' };
	},

	// ④ ban トグル（staff 可）
	toggleBan: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin' && locals.user?.role !== 'staff') return fail(403, { message: '権限がありません' });
		const actor = locals.user.id;
		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const banned = form.get('banned') === 'true';
		setForumBan(userId, banned, actor);
		return { ok: 'ban' };
	}
};
