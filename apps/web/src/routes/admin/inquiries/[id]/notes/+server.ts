// 社内メモ（2026-11-27）。お客様には送らない。POST で追加、DELETE で自分のメモを消す
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseServerClient, ADMIN_SUPABASE } from '$lib/server/auth';

function guard(event: Parameters<RequestHandler>[0]) {
	if (event.request.headers.get('origin') !== event.url.origin) return { error: '許可されていないアクセスです。', status: 403 };
	const user = event.locals.user;
	if (!ADMIN_SUPABASE || !user || !['admin', 'staff'].includes(user.role)) return { error: 'ログインし直してください。', status: 401 };
	return null;
}
const reply = (data: unknown, status = 200) => json(data, { status, headers: { 'cache-control': 'no-store' } });
const message = (e: { message: string }) => (/[ぁ-んァ-ン一-龥]/.test(e.message) ? e.message.replace(/^.*?: /, '') : 'メモを保存できませんでした。時間をおいて再度お試しください。');

export const POST: RequestHandler = async (event) => {
	const ng = guard(event);
	if (ng) return reply({ error: ng.error }, ng.status);
	let input: { body?: unknown };
	try {
		input = await event.request.json();
	} catch {
		return reply({ error: '入力内容を確認してください。' }, 400);
	}
	const body = typeof input?.body === 'string' ? input.body.replace(/\r\n/g, '\n') : '';
	if (!body.trim() || body.length > 5000) return reply({ error: 'メモは1〜5,000文字で入力してください。' }, 400);
	const db = createSupabaseServerClient(event);
	const { data, error } = await db.schema('book').rpc('admin_inquiry_note', { p_id: event.params.id, p_body: body, p_name: String(event.locals.user?.name ?? '').slice(0, 100) });
	if (error) return reply({ error: message(error) }, 400);
	return reply({ id: data });
};

export const DELETE: RequestHandler = async (event) => {
	const ng = guard(event);
	if (ng) return reply({ error: ng.error }, ng.status);
	let input: { id?: unknown };
	try {
		input = await event.request.json();
	} catch {
		return reply({ error: '入力内容を確認してください。' }, 400);
	}
	if (typeof input?.id !== 'string') return reply({ error: '入力内容を確認してください。' }, 400);
	const db = createSupabaseServerClient(event);
	const { error } = await db.schema('book').rpc('admin_inquiry_note', { p_id: event.params.id, p_note: input.id, p_delete: true });
	if (error) return reply({ error: message(error) }, 400);
	return reply({ ok: true });
};
