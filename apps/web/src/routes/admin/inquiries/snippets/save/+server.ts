// 返信作成画面の「この本文を定型文に保存」（2026-11-27）。一覧での編集は /admin/inquiries/snippets
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseServerClient, ADMIN_SUPABASE } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';

export const POST: RequestHandler = async (event) => {
	const reply = (data: unknown, status = 200) => json(data, { status, headers: { 'cache-control': 'no-store' } });
	if (event.request.headers.get('origin') !== event.url.origin) return reply({ error: '許可されていないアクセスです。' }, 403);
	const user = event.locals.user;
	if (!ADMIN_SUPABASE || !user || !['admin', 'staff'].includes(user.role)) return reply({ error: 'ログインし直してください。' }, 401);
	let input: { title?: unknown; body?: unknown };
	try {
		input = await event.request.json();
	} catch {
		return reply({ error: '入力内容を確認してください。' }, 400);
	}
	const title = typeof input?.title === 'string' ? input.title.trim() : '';
	const body = typeof input?.body === 'string' ? input.body.replace(/\r\n/g, '\n') : '';
	if (!title || title.length > 80) return reply({ error: '定型文の名前は1〜80文字で入力してください。' }, 400);
	if (!body.trim() || body.length > 10000) return reply({ error: '定型文の本文は1〜10,000文字で入力してください。' }, 400);
	const db = createSupabaseServerClient(event);
	const { data, error } = await db.schema('book').rpc('admin_inquiry_snippet_save', { p_facility: FACILITY_UUID['f-nishiwaga'], p_id: null, p_title: title, p_body: body, p_sort: 0 });
	if (error) return reply({ error: '定型文を保存できませんでした。' }, 400);
	return reply({ id: data, title, body, sort_order: 0 });
};
