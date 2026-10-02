// FAQ ボット公開 API の共通部品（設計書 autumn_book_faq_bot_design.md §5）。
// 施設HP（別ドメイン）に埋め込むウィジェットから呼ばれる。認証なし・読み取り＋質問ログの記録のみ。
import { json } from '@sveltejs/kit';
import { supa } from '$lib/server/supabase';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { renderMarkdown } from '$lib/markdown';
import type { FaqLocale, SearchableFaq } from './search';

/** URL の短い識別子 → 施設（uuid・CORS 許可オリジン・未回答時の誘導先） */
export const FAQ_FACILITIES: Record<
	string,
	{ uuid: string; origins: string[]; phone: string; contactUrl: string }
> = {
	oga: {
		uuid: FACILITY_UUID['f-oga'],
		origins: ['https://oga.yamado.co.jp'],
		phone: '0185-47-7776',
		contactUrl: 'https://oga.yamado.co.jp/contact/'
	},
	nishiwaga: {
		uuid: FACILITY_UUID['f-nishiwaga'],
		origins: ['https://www.yamado.co.jp', 'https://nishiwaga.yamado.co.jp'],
		phone: '0197-82-2222',
		contactUrl: 'https://www.yamado.co.jp/contact/'
	}
};
// autumn-book 自身（施設ページ）と、ローカル開発
const COMMON_ORIGINS = ['https://book.yamado.app', 'http://localhost:5173', 'http://localhost:4391'];

export function facilityBySlug(slug: string) {
	return Object.prototype.hasOwnProperty.call(FAQ_FACILITIES, slug) ? FAQ_FACILITIES[slug] : null;
}

export function parseLocale(v: unknown): FaqLocale {
	return v === 'en' || v === 'zh-TW' ? v : 'ja';
}

/** 許可オリジンなら CORS ヘッダを返す（許可外は付けない＝ブラウザが応答を読めない） */
export function corsHeaders(request: Request, slug: string): Record<string, string> {
	const origin = request.headers.get('origin') ?? '';
	const f = facilityBySlug(slug);
	const ok = !!f && (f.origins.includes(origin) || COMMON_ORIGINS.includes(origin));
	return ok
		? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-max-age': '86400' }
		: { vary: 'Origin' };
}

export function faqJson(request: Request, slug: string, body: unknown, init: { status?: number; cache?: string } = {}) {
	return json(body, {
		status: init.status ?? 200,
		headers: { ...corsHeaders(request, slug), 'cache-control': init.cache ?? 'no-store' }
	});
}

// ---- 公開 FAQ の読み込み（5分キャッシュ。Workers のアイソレート内のメモリ） ----

export interface PublicFaq extends SearchableFaq {
	sortOrder: number;
}
const cache = new Map<string, { at: number; items: PublicFaq[] }>();
const TTL_MS = 5 * 60 * 1000;

export async function loadPublicFaqs(facilityUuid: string, locale: FaqLocale): Promise<PublicFaq[]> {
	const key = `${facilityUuid}:${locale}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.items;

	// RLS（faqs_public_read）で公開分だけが返る
	const { data, error } = await supa()
		.from('faqs')
		.select('id, category, question, answer, keywords, sort_order')
		.eq('facility_id', facilityUuid)
		.eq('is_published', true)
		.order('sort_order');
	if (error) throw error;
	let items: PublicFaq[] = (data ?? []).map((r) => ({
		id: String(r.id),
		category: String(r.category ?? ''),
		question: String(r.question ?? ''),
		answer: String(r.answer ?? ''),
		keywords: Array.isArray(r.keywords) ? (r.keywords as string[]) : [],
		sortOrder: Number(r.sort_order ?? 0)
	}));

	// 英語・繁体字: 公開済みの訳で上書き（訳が無い項目は日本語のまま）
	if (locale !== 'ja' && items.length > 0) {
		const { data: tr } = await supa()
			.from('content_translations')
			.select('entity_id, fields')
			.eq('entity_type', 'faq')
			.eq('locale', locale)
			.eq('is_published', true)
			.in('entity_id', items.map((i) => i.id));
		const byId = new Map(((tr ?? []) as { entity_id: string; fields: Record<string, unknown> }[]).map((t) => [t.entity_id, t.fields]));
		const str = (v: unknown, fb: string) => (typeof v === 'string' && v.trim() !== '' ? v : fb);
		items = items.map((i) => {
			const f = byId.get(i.id);
			if (!f) return i;
			return {
				...i,
				question: str(f.question, i.question),
				answer: str(f.answer, i.answer),
				category: str(f.category, i.category),
				keywords: Array.isArray(f.keywords) ? (f.keywords as string[]) : i.keywords
			};
		});
	}

	cache.set(key, { at: Date.now(), items });
	return items;
}

export function answerHtml(markdown: string): string {
	return renderMarkdown(markdown);
}

// ---- レート制限（KV・固定窓）。KV 未バインド・障害時は止めない ----

export async function allowRequest(kv: KVNamespace | undefined, key: string, limit: number, windowSec: number): Promise<boolean> {
	if (!kv) return true;
	try {
		const k = `faq:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
		const n = parseInt((await kv.get(k)) ?? '0', 10);
		if (n >= limit) return false;
		await kv.put(k, String(n + 1), { expirationTtl: Math.max(60, windowSec * 2) });
	} catch (e) {
		console.error('faq rate limit error:', e instanceof Error ? e.message : String(e));
	}
	return true;
}

/** 未回答時の誘導先（ウィジェットに渡す） */
export function fallbackFor(slug: string) {
	const f = facilityBySlug(slug)!;
	return { phone: f.phone, contactUrl: f.contactUrl };
}
