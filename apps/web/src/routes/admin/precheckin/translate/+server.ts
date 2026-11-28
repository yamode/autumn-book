// 管理画面（/admin/precheckin）の完了画面の「施設からのご案内」を、日本語から英語・繁体字の下書きにして返す（保存しない・2026-11-28）。
// 翻訳は autumn-shared の Edge Function translate-site-texts（会員特典の翻訳・問い合わせ翻訳と同じ AI 基盤）。
// 権限は Edge Function 側でもテナントのスタッフか確かめる。画面は受け取った訳を欄に入れてから自動保存する。
import { json } from '@sveltejs/kit';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { DONE_MESSAGE_MAX, DONE_TITLE_MAX } from '$lib/precheckin-done-message';
import type { RequestHandler } from './$types';

type Out = { en: string; zh: string; titleEn: string; titleZh: string };

export const POST: RequestHandler = async (event) => {
	const reply = (data: unknown, status = 200) => json(data, { status, headers: { 'cache-control': 'no-store' } });
	if (event.request.headers.get('origin') !== event.url.origin) return reply({ error: '許可されていないアクセスです。' }, 403);
	if (!ADMIN_SUPABASE || !['admin', 'staff'].includes(event.locals.user?.role ?? '')) {
		return reply({ error: 'ログインし直してください。' }, 401);
	}
	const raw = await event.request.text();
	if (raw.length > 16000) return reply({ error: '文章が長すぎます。' }, 413);
	let text = '';
	let title = '';
	try {
		const input = JSON.parse(raw) as { text?: unknown; title?: unknown };
		text = typeof input?.text === 'string' ? input.text.trim() : '';
		title = typeof input?.title === 'string' ? input.title.trim().slice(0, DONE_TITLE_MAX) : '';
	} catch {
		return reply({ error: '入力内容を確認してください。' }, 400);
	}
	if (!text) return reply({ error: '翻訳する日本語の文章がありません。先に日本語を入れてください。' }, 400);
	if (text.length > DONE_MESSAGE_MAX) return reply({ error: `日本語は ${DONE_MESSAGE_MAX} 文字までです。` }, 413);

	const db = createSupabaseServerClient(event);
	const one = async (lang: 'en' | 'zh-TW'): Promise<{ text: string; title: string }> => {
		const fields: Record<string, string> = { done_message: text };
		if (title) fields.done_title = title;
		const { data, error } = await db.functions.invoke('translate-site-texts', { body: { lang, fields } });
		if (error) {
			let message = '翻訳できませんでした。時間をおいて再度お試しください。';
			try {
				const r = await error.context?.json();
				if (typeof r?.error === 'string') message = r.error === 'forbidden' ? '翻訳する権限がありません。' : r.error;
			} catch {
				// 本文が読めないときは既定の文言
			}
			throw new Error(message);
		}
		const out = (data as { fields?: Record<string, unknown> } | null)?.fields ?? {};
		const v = out.done_message;
		if (typeof v !== 'string' || !v.trim()) throw new Error('翻訳できませんでした。もう一度お試しください。');
		const t = typeof out.done_title === 'string' ? out.done_title.trim().slice(0, DONE_TITLE_MAX) : '';
		return { text: v.trim().slice(0, DONE_MESSAGE_MAX), title: t };
	};
	try {
		const [en, zh] = await Promise.all([one('en'), one('zh-TW')]);
		return reply({ en: en.text, zh: zh.text, titleEn: en.title, titleZh: zh.title } satisfies Out);
	} catch (e) {
		return reply({ error: e instanceof Error ? e.message : '翻訳できませんでした。接続をご確認ください。' }, 503);
	}
};
