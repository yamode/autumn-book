// 「〜さんが返信中」の表示（2026-11-27）。開いている間は 15 秒ごと、入力中はその都度（間引きは画面側）に呼ぶ。
// 自分の様子を書き、ほかに開いている人（45 秒以内）を返す。閉じるときは leave で消す
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseServerClient, ADMIN_SUPABASE } from '$lib/server/auth';

export const POST: RequestHandler = async (event) => {
	const reply = (data: unknown, status = 200) => json(data, { status, headers: { 'cache-control': 'no-store' } });
	if (event.request.headers.get('origin') !== event.url.origin) return reply({ error: '許可されていないアクセスです。' }, 403);
	const user = event.locals.user;
	if (!ADMIN_SUPABASE || !user || !['admin', 'staff'].includes(user.role)) return reply({ error: 'ログインし直してください。' }, 401);
	let input: { typing?: unknown; leave?: unknown };
	try {
		input = await event.request.json();
	} catch {
		input = {};
	}
	const db = createSupabaseServerClient(event);
	const { data, error } = await db.schema('book').rpc('admin_inquiry_presence', {
		p_id: event.params.id,
		p_name: String(user.name ?? '').slice(0, 100),
		p_typing: input?.typing === true,
		p_leave: input?.leave === true
	});
	if (error) return reply({ others: [] }, 200); // 表示の補助なので、失敗しても画面は止めない
	return reply({ others: (data as { name: string; typing: boolean }[]) ?? [] });
};
