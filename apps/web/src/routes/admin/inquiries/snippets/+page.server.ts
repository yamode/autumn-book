// 問い合わせの返信の定型文（2026-11-27）。返信作成画面で「/」を打つと候補に出る。西和賀の施設ごと
import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import type { InquirySnippet } from '$lib/inquiry-snippets';

const FACILITY = FACILITY_UUID['f-nishiwaga'];

export const load: PageServerLoad = async (event) => {
	if (!ADMIN_SUPABASE) error(503, '本番データ環境で利用できます。');
	event.setHeaders({ 'cache-control': 'no-store' });
	const { data, error: e } = await createSupabaseServerClient(event)
		.schema('book')
		.from('inquiry_snippets')
		.select('id,title,body,sort_order')
		.eq('facility_id', FACILITY)
		.order('sort_order')
		.order('title');
	if (e) error(503, '定型文を読み込めませんでした。時間をおいて再読み込みしてください。');
	return { snippets: (data ?? []) as InquirySnippet[] };
};

const staffOnly = (event: Parameters<Actions[string]>[0]) => ADMIN_SUPABASE && ['admin', 'staff'].includes(event.locals.user?.role ?? '');

export const actions: Actions = {
	save: async (event) => {
		if (!staffOnly(event)) return fail(403, { message: 'スタッフとしてログインしてください。' });
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '') || null;
		const title = String(form.get('title') ?? '').trim();
		const body = String(form.get('body') ?? '').replace(/\r\n/g, '\n');
		const sort = Number(form.get('sort') ?? 0);
		if (!title || title.length > 80) return fail(400, { message: '定型文の名前は1〜80文字で入力してください。', id });
		if (!body.trim() || body.length > 10000) return fail(400, { message: '定型文の本文は1〜10,000文字で入力してください。', id });
		const { error: e } = await createSupabaseServerClient(event)
			.schema('book')
			.rpc('admin_inquiry_snippet_save', { p_facility: FACILITY, p_id: id, p_title: title, p_body: body, p_sort: Number.isFinite(sort) ? Math.round(sort) : 0 });
		if (e) return fail(400, { message: '定型文を保存できませんでした。', id });
		return { done: id ? `「${title}」を保存しました。` : `「${title}」を追加しました。` };
	},
	delete: async (event) => {
		if (!staffOnly(event)) return fail(403, { message: 'スタッフとしてログインしてください。' });
		const form = await event.request.formData();
		const { error: e } = await createSupabaseServerClient(event).schema('book').rpc('admin_inquiry_snippet_delete', { p_id: String(form.get('id') ?? '') });
		if (e) return fail(400, { message: '定型文を消せませんでした。' });
		return { done: '定型文を消しました。' };
	}
};
