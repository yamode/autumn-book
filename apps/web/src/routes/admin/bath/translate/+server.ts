// 管理画面（/admin/bath）の「日本語から翻訳」。日本語の文章を英語・繁体字の下書きにして返すだけ（保存しない）。
// 翻訳は autumn-shared の Edge Function translate-bath-content（問い合わせ翻訳と同じ AI 基盤）。
// 権限は Edge Function 側でも book.private_bath_contents_admin（施設の権限）で確かめる。
import { json } from '@sveltejs/kit';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { facilities } from '$lib/server/store';
import { BATH_CONTENT_FIELDS } from '$lib/private-bath-content';
import type { RequestHandler } from './$types';

const TARGETS = ['en', 'zh-TW'];
const KEYS = BATH_CONTENT_FIELDS.map((f) => f.key) as readonly string[];

export const POST: RequestHandler = async (event) => {
	const reply = (data: unknown, status = 200) => json(data, { status, headers: { 'cache-control': 'no-store' } });
	if (event.request.headers.get('origin') !== event.url.origin) return reply({ error: '許可されていないアクセスです。' }, 403);
	if (!ADMIN_SUPABASE || !['admin', 'staff'].includes(event.locals.user?.role ?? '')) {
		return reply({ error: 'ログインし直してください。' }, 401);
	}
	const raw = await event.request.text();
	if (raw.length > 16000) return reply({ error: '文章が長すぎます。' }, 413);
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
	for (const k of KEYS) {
		const s = typeof src[k] === 'string' ? (src[k] as string).trim() : '';
		if (s) fields[k] = s;
	}
	if (!Object.keys(fields).length) return reply({ error: '翻訳する日本語の文章がありません。先に日本語を保存してください。' }, 400);

	// いま選んでいる施設（管理画面の共通レイアウトと同じ ab_fac クッキー）
	const facId = event.cookies.get('ab_fac') ?? facilities[0].id;
	const facility = FACILITY_UUID[facId] ?? facId;

	try {
		const db = createSupabaseServerClient(event);
		const { data, error } = await db.functions.invoke('translate-bath-content', { body: { facility, lang, fields } });
		if (error) {
			let message = '翻訳できませんでした。時間をおいて再度お試しください。';
			try {
				const r = await error.context?.json();
				if (typeof r?.error === 'string' && r.error !== 'forbidden') message = r.error;
				if (r?.error === 'forbidden') message = 'この施設を編集する権限がありません。';
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
