// ヘルプページ（/help）のよくある質問の編集（docs/member-support.md「管理画面」）。一覧・追加・編集・公開/非公開・削除・並び順。
// DB 関数（スタッフなら誰でも）: admin_support_faqs() / admin_support_faq_save(p_id, p_category, p_question, p_answer, p_sort_order, p_is_published)
//   / admin_support_faq_delete(p_id)
// 施設の FAQ ボット（/admin/faqs）とは別。こちらは会員システムについてのよくある質問。
import { fail } from '@sveltejs/kit';
import { ADMIN_SUPABASE } from '$lib/server/auth';
import { bookAdmin } from '$lib/server/admin-app-data';
import { supportAdminError } from '$lib/server/member-support';
import { isSupportCategory } from '$lib/support';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

type SupportFaqRow = {
	id: string;
	category: string;
	question: string;
	answer: string;
	sort_order: number;
	is_published: boolean;
	updated_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const load: PageServerLoad = async (event) => {
	if (!ADMIN_SUPABASE) return { live: false as const, faqs: [] as SupportFaqRow[], error: null as string | null };
	const { data, error } = await bookAdmin(event).rpc('admin_support_faqs');
	if (error) return { live: true as const, faqs: [] as SupportFaqRow[], error: supportAdminError(error) };
	return { live: true as const, faqs: (Array.isArray(data) ? data : []) as SupportFaqRow[], error: null as string | null };
};

function guard() {
	if (!ADMIN_SUPABASE) return fail(400, { message: 'この環境では操作できません（DATA_SOURCE / AUTH_MODE が supabase ではありません）。' });
	return null;
}

async function save(event: RequestEvent, isNew: boolean) {
	const g = guard();
	if (g) return g;
	const form = await event.request.formData();
	const id = isNew ? null : String(form.get('id') ?? '');
	if (!isNew && !UUID_RE.test(id ?? '')) return fail(400, { message: '対象が見つかりませんでした。', id });
	const category = String(form.get('category') ?? '');
	const question = String(form.get('question') ?? '').trim();
	const answer = String(form.get('answer') ?? '').replace(/\r\n?/g, '\n').trim();
	const sortOrder = Math.trunc(Number(form.get('sortOrder') ?? 0)) || 0;
	const isPublished = form.get('isPublished') === 'on';
	if (!isSupportCategory(category)) return fail(400, { message: 'カテゴリを選んでください。', id });
	if (!question || !answer) return fail(400, { message: '質問と回答を入力してください。', id });
	if (question.length > 300 || answer.length > 5000) return fail(400, { message: '質問は 300 文字、回答は 5000 文字までです。', id });
	const { error } = await bookAdmin(event).rpc('admin_support_faq_save', {
		p_id: id,
		p_category: category,
		p_question: question,
		p_answer: answer,
		p_sort_order: sortOrder,
		p_is_published: isPublished
	});
	if (error) return fail(400, { message: supportAdminError(error), id });
	return { done: isNew ? ('create' as const) : ('update' as const), id };
}

export const actions: Actions = {
	create: (event) => save(event, true),
	update: (event) => save(event, false),
	delete: async (event) => {
		const g = guard();
		if (g) return g;
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!UUID_RE.test(id)) return fail(400, { message: '対象が見つかりませんでした。', id });
		const { error } = await bookAdmin(event).rpc('admin_support_faq_delete', { p_id: id });
		if (error) return fail(400, { message: supportAdminError(error), id });
		return { done: 'delete' as const, id };
	}
};
