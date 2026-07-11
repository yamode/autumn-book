// 板管理（板の追加・編集）は DATA_SOURCE=supabase 時に実データ（book.forum_boards）へ保存する。
//   - 読み取りは anon で可（forum_list_boards）。
//   - 書き込みは管理者の Supabase セッションが必要（本番 AUTH_MODE=supabase／forum_upsert_board は tenant_admin ガード）。
// スレ/投稿/ban のモデレーションは admin 用 Supabase RPC が未整備のため P5。
//   本番（DATA_SOURCE=supabase）ではデモデータを見せず、モデレーション UI を無効化して honest に拒否する。
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
import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { listForumBoardsData, upsertForumBoard as sbUpsertForumBoard } from '$lib/server/supabase-data';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const isAdmin = locals.user?.role === 'admin';

	// 板一覧: 本番は Supabase（公開側と同一ソース）、demo はインメモリ。
	const boards =
		DATA_SOURCE === 'supabase'
			? (await listForumBoardsData()).map((b) => ({
					id: b.id,
					slug: b.slug,
					title: b.title,
					description: b.description,
					sortOrder: b.sortOrder,
					isArchived: b.isArchived
				}))
			: [...forumBoards].sort((a, b) => a.sortOrder - b.sortOrder);

	// スレ/投稿/ban のモデレーションはまだ demo データのみ（P5）。本番では無効化する。
	const moderationEnabled = DATA_SOURCE !== 'supabase';

	// 板選択（スレ操作・投稿削除用）。既定は実際に表示している板一覧の先頭。
	const selectedBoardId = url.searchParams.get('board') ?? boards[0]?.id ?? '';
	const selectedThreadId = url.searchParams.get('thread') ?? '';

	const threads =
		moderationEnabled && selectedBoardId
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
	const posts = moderationEnabled && selectedThreadId ? listForumPosts(selectedThreadId) : [];
	const selectedThread = moderationEnabled && selectedThreadId ? getForumThread(selectedThreadId) : undefined;

	const profiles = moderationEnabled
		? listForumProfiles().map((p) => ({
				userId: p.userId,
				nickname: p.nickname,
				role: p.role,
				isBanned: p.isBanned
			}))
		: [];

	return {
		isAdmin,
		moderationEnabled,
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
	upsertBoard: async (event) => {
		const { request, locals } = event;
		if (locals.user?.role !== 'admin') return fail(403, { message: '板の編集は管理者のみ可能です' });
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const slug = String(form.get('slug') ?? '').trim();
		const title = String(form.get('title') ?? '').trim();
		if (!slug || !title) return fail(400, { message: 'slug とタイトルは必須です' });
		const input = {
			id: id || undefined,
			slug,
			title,
			description: String(form.get('description') ?? ''),
			sortOrder: Number(form.get('sortOrder') ?? 0) || 0,
			isArchived: form.get('isArchived') === 'on'
		};

		if (DATA_SOURCE === 'supabase') {
			// 本番（AUTH_MODE=supabase）の管理者は Supabase セッションを持つ → その client で
			// book.forum_boards へ保存（RPC forum_upsert_board は tenant_admin ガード）。
			// ローカル demo 管理者は Supabase セッションが無いため RPC が not_authenticated を返し、
			// 下の分岐で honest なエラー文言を返す（デモに黙って書いて消える挙動を避ける）。
			if (AUTH_MODE !== 'supabase') {
				return fail(400, {
					message: '実データの板保存には Supabase 管理者ログインが必要です（この環境は管理者=デモ認証のため保存できません）'
				});
			}
			try {
				await sbUpsertForumBoard(input, createSupabaseServerClient(event));
			} catch (e) {
				const msg = e instanceof Error ? e.message : '';
				if (msg.includes('slug_taken')) return fail(400, { message: 'その slug は既に使われています' });
				if (msg.includes('invalid_input')) return fail(400, { message: 'slug とタイトルは必須です' });
				if (msg.includes('not_found')) return fail(404, { message: '対象の板が見つかりません' });
				if (msg.includes('not_authenticated') || msg.includes('forbidden')) {
					return fail(403, {
						message: '板を編集する権限がありません（管理者アカウントに core.memberships の tenant_admin 行が必要です）'
					});
				}
				return fail(500, { message: `保存に失敗しました: ${msg || '不明なエラー'}` });
			}
			return { ok: 'board' };
		}

		const res = upsertForumBoard(input);
		if ('error' in res) return fail(400, { message: 'その slug は既に使われています' });
		return { ok: 'board' };
	},

	// ② スレの pin / lock / 削除トグル（staff 可）
	moderateThread: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin' && locals.user?.role !== 'staff') return fail(403, { message: '権限がありません' });
		if (DATA_SOURCE === 'supabase') return fail(400, { message: 'スレッドのモデレーションは本番データ未対応です（P5）' });
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
		if (DATA_SOURCE === 'supabase') return fail(400, { message: '投稿削除は本番データ未対応です（P5）' });
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
		if (DATA_SOURCE === 'supabase') return fail(400, { message: '会員の ban は本番データ未対応です（P5）' });
		const actor = locals.user.id;
		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const banned = form.get('banned') === 'true';
		setForumBan(userId, banned, actor);
		return { ok: 'ban' };
	}
};
