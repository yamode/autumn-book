// 管理画面（/admin/member-benefits）の「日本語から AI で翻訳」。日本語の文言を英語・繁体字の下書きにして返すだけ（保存しない）。
// 翻訳は autumn-shared の Edge Function translate-site-texts（問い合わせ翻訳と同じ AI 基盤）。権限は Edge Function 側でもテナントのスタッフか確かめる。
import { json } from '@sveltejs/kit';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { MEMBER_BENEFIT_TEXT_KEYS } from '$lib/member-benefit-texts';
import type { RequestHandler } from './$types';

const TARGETS = ['en', 'zh-TW'];

export const POST: RequestHandler = async (event) => {
	const reply = (data: unknown, status = 200) => json(data, { status, headers: { 'cache-control': 'no-store' } });
	if (event.request.headers.get('origin') !== event.url.origin) return reply({ error: '許可されていないアクセスです。' }, 403);
	if (!ADMIN_SUPABASE || event.locals.user?.role !== 'admin') return reply({ error: '編集権限がありません。' }, 401);
	const raw = await event.request.text();
	if (raw.length > 32000) return reply({ error: '文章が長すぎます。' }, 413);
	let input: { lang?: unknown; fields?: unknown };
	try {
		input = JSON.parse(raw);
	} catch {
		return reply({ error: '入力内容を確認してください。' }, 400);
	}
	const lang = String(input?.lang ?? '');
	if (!TARGETS.includes(lang)) return reply({ error: '翻訳先の言語を選んでください。' }, 400);
	const src = (input.fields ?? {}) as Record<string, unknown>;
	const fields: Record<string, string> = {};
	for (const k of MEMBER_BENEFIT_TEXT_KEYS) {
		const s = typeof src[k] === 'string' ? (src[k] as string).trim() : '';
		if (s) fields[k] = s;
	}
	if (!Object.keys(fields).length) return reply({ error: '翻訳する日本語の文言がありません。' }, 400);
	try {
		const { data, error } = await createSupabaseServerClient(event).functions.invoke('translate-site-texts', { body: { lang, fields } });
		if (error) {
			let message = '翻訳できませんでした。時間をおいて再度お試しください。';
			try {
				const r = await error.context?.json();
				if (typeof r?.error === 'string') message = r.error === 'forbidden' ? '翻訳する権限がありません。' : r.error;
			} catch {
				// 本文が読めないときは既定の文言
			}
			return reply({ error: message }, 503);
		}
		return reply(data);
	} catch {
		return reply({ error: '翻訳できませんでした。接続をご確認ください。' }, 503);
	}
};
