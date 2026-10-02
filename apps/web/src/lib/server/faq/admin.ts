// FAQ ボットの管理画面（/admin/faqs）用のサーバー関数。設計書 autumn_book_faq_bot_design.md §7。
// RLS（faqs_staff_all / faq_queries_staff_* / content_translations）は authenticated + has_facility_access が前提。
// 呼び出し側は Supabase Auth セッションに紐づいたクライアント（auth.ts の createSupabaseServerClient(event)）を渡すこと。
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalize } from './search';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

export interface AdminFaq {
	id: string;
	category: string;
	question: string;
	answer: string;
	keywords: string[];
	isPublished: boolean;
	sortOrder: number;
	source: string;
	viewCount: number;
}
export type FaqTr = { fields: { category?: string; question?: string; answer?: string; keywords?: string[] }; isPublished: boolean } | null;

const COLS = 'id, category, question, answer, keywords, is_published, sort_order, source, view_count';
function mapFaq(r: Record<string, unknown>): AdminFaq {
	return {
		id: String(r.id),
		category: String(r.category ?? ''),
		question: String(r.question ?? ''),
		answer: String(r.answer ?? ''),
		keywords: Array.isArray(r.keywords) ? (r.keywords as string[]) : [],
		isPublished: !!r.is_published,
		sortOrder: Number(r.sort_order ?? 0),
		source: String(r.source ?? 'manual'),
		viewCount: Number(r.view_count ?? 0)
	};
}

/** 改行・読点区切りの入力を言い換えの配列に（重複・空を除く） */
export function parseKeywords(input: string): string[] {
	return [...new Set(input.split(/[\n、,]/).map((s) => s.trim()).filter(Boolean))].slice(0, 30);
}

export async function listFaqsAdmin(client: SupabaseClient, facilityId: string): Promise<AdminFaq[]> {
	const { data, error } = await client.schema('book').from('faqs').select(COLS).eq('facility_id', facilityId).order('sort_order').order('created_at');
	if (error) throw error;
	return (data ?? []).map(mapFaq);
}

export async function listFaqTranslations(client: SupabaseClient, faqIds: string[]): Promise<Record<string, { en: FaqTr; 'zh-TW': FaqTr }>> {
	const out: Record<string, { en: FaqTr; 'zh-TW': FaqTr }> = {};
	for (const id of faqIds) out[id] = { en: null, 'zh-TW': null };
	if (faqIds.length === 0) return out;
	const { data, error } = await client
		.schema('book')
		.from('content_translations')
		.select('entity_id, locale, fields, is_published')
		.eq('entity_type', 'faq')
		.in('entity_id', faqIds);
	if (error) throw error;
	for (const r of data ?? []) {
		const loc = r.locale as 'en' | 'zh-TW';
		if (out[r.entity_id] && (loc === 'en' || loc === 'zh-TW')) out[r.entity_id][loc] = { fields: (r.fields ?? {}) as NonNullable<FaqTr>['fields'], isPublished: !!r.is_published };
	}
	return out;
}

export async function addFaqAdmin(
	client: SupabaseClient,
	facilityId: string,
	input: { category: string; question: string; answer: string; keywords: string[]; source?: string; isPublished?: boolean }
): Promise<AdminFaq> {
	// 末尾に追加（並び順 = 現在の最大 + 10）
	const { data: last } = await client.schema('book').from('faqs').select('sort_order').eq('facility_id', facilityId).order('sort_order', { ascending: false }).limit(1);
	const sortOrder = (Number(last?.[0]?.sort_order ?? 0) || 0) + 10;
	const { data, error } = await client
		.schema('book')
		.from('faqs')
		.insert({
			tenant_id: TENANT_ID,
			facility_id: facilityId,
			category: input.category || 'その他',
			question: input.question,
			answer: input.answer,
			keywords: input.keywords,
			source: input.source ?? 'manual',
			is_published: input.isPublished ?? false,
			sort_order: sortOrder
		})
		.select(COLS)
		.single();
	if (error) throw error;
	return mapFaq(data);
}

export async function updateFaqAdmin(
	client: SupabaseClient,
	faqId: string,
	input: { category: string; question: string; answer: string; keywords: string[]; isPublished: boolean; sortOrder: number }
): Promise<void> {
	const { error } = await client
		.schema('book')
		.from('faqs')
		.update({
			category: input.category || 'その他',
			question: input.question,
			answer: input.answer,
			keywords: input.keywords,
			is_published: input.isPublished,
			sort_order: input.sortOrder,
			updated_at: new Date().toISOString()
		})
		.eq('id', faqId);
	if (error) throw error;
}

export async function saveFaqTranslationAdmin(
	client: SupabaseClient,
	facilityId: string,
	faqId: string,
	locale: 'en' | 'zh-TW',
	fields: { category: string; question: string; answer: string; keywords: string[] },
	isPublished: boolean
): Promise<void> {
	const { error } = await client.schema('book').from('content_translations').upsert(
		{
			tenant_id: TENANT_ID,
			facility_id: facilityId,
			entity_type: 'faq',
			entity_id: faqId,
			locale,
			fields,
			is_published: isPublished,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'entity_type,entity_id,locale' }
	);
	if (error) throw error;
}

// ---------------------------------------------------------------- 未回答の質問

export interface QueryGroup {
	normalized: string;
	sample: string; // 代表の質問文（最新）
	count: number;
	lastAt: string;
	locale: string;
	pages: string[];
	reason: 'unanswered' | 'not_helpful';
	ids: string[];
}

/** 未対応（open）のうち「回答なし」または「解決しなかった」質問を、正規化文字列でまとめて件数順に返す */
export async function listUnansweredGroups(client: SupabaseClient, facilityId: string, sinceDays = 90): Promise<QueryGroup[]> {
	const since = new Date(Date.now() - sinceDays * 864e5).toISOString();
	const { data, error } = await client
		.schema('book')
		.from('faq_queries')
		.select('id, query, normalized, answered, helpful, locale, page_path, created_at')
		.eq('facility_id', facilityId)
		.eq('status', 'open')
		.gte('created_at', since)
		.or('answered.eq.false,helpful.eq.false')
		.order('created_at', { ascending: false })
		.limit(2000);
	if (error) throw error;
	const groups = new Map<string, QueryGroup>();
	for (const r of data ?? []) {
		const key = `${r.locale}:${r.normalized || r.query}`;
		const g = groups.get(key);
		if (g) {
			g.count++;
			g.ids.push(r.id);
			if (r.page_path && !g.pages.includes(r.page_path) && g.pages.length < 3) g.pages.push(r.page_path);
		} else {
			groups.set(key, {
				normalized: r.normalized || r.query,
				sample: r.query,
				count: 1,
				lastAt: r.created_at,
				locale: r.locale,
				pages: r.page_path ? [r.page_path] : [],
				reason: r.answered ? 'not_helpful' : 'unanswered',
				ids: [r.id]
			});
		}
	}
	return [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt));
}

/** 直近30日の指標 */
export async function faqStats(client: SupabaseClient, facilityId: string) {
	const since = new Date(Date.now() - 30 * 864e5).toISOString();
	const { data, error } = await client
		.schema('book')
		.from('faq_queries')
		.select('answered, helpful, status')
		.eq('facility_id', facilityId)
		.gte('created_at', since)
		.limit(10000);
	if (error) throw error;
	const rows = data ?? [];
	const total = rows.length;
	const answered = rows.filter((r) => r.answered).length;
	const rated = rows.filter((r) => r.helpful !== null);
	const helpful = rated.filter((r) => r.helpful).length;
	const open = rows.filter((r) => r.status === 'open' && (!r.answered || r.helpful === false)).length;
	return {
		total,
		answeredRate: total ? Math.round((answered / total) * 100) : null,
		helpfulRate: rated.length ? Math.round((helpful / rated.length) * 100) : null,
		open
	};
}

/** まとめた質問を「対応済み」「対象外」にする */
export async function setQueriesStatus(client: SupabaseClient, ids: string[], status: 'resolved' | 'ignored', resolvedFaqId?: string): Promise<void> {
	if (ids.length === 0) return;
	const { error } = await client
		.schema('book')
		.from('faq_queries')
		.update({ status, resolved_faq_id: resolvedFaqId ?? null, updated_at: new Date().toISOString() })
		.in('id', ids.slice(0, 2000));
	if (error) throw error;
}

/** 質問文を既存 FAQ の言い換えに追加する（次回から当たるように） */
export async function addKeywordToFaq(client: SupabaseClient, faqId: string, phrase: string): Promise<void> {
	const { data, error } = await client.schema('book').from('faqs').select('keywords').eq('id', faqId).single();
	if (error) throw error;
	const current = Array.isArray(data?.keywords) ? (data.keywords as string[]) : [];
	if (current.some((k) => normalize(k) === normalize(phrase))) return;
	const { error: e2 } = await client.schema('book').from('faqs').update({ keywords: [...current, phrase].slice(0, 30), updated_at: new Date().toISOString() }).eq('id', faqId);
	if (e2) throw e2;
}

// ---------------------------------------------------------------- 初期データの取り込み

export interface SeedItem {
	category: string;
	question: string;
	answer: string;
	keywords?: string[];
	source: 'seed_talkappi' | 'seed_tripla' | 'seed_hp';
}

/** 初期データを下書きで登録する。同じ質問（正規化して一致）が既にあるものは飛ばす */
export async function importSeedFaqs(client: SupabaseClient, facilityId: string, items: SeedItem[]): Promise<{ added: number; skipped: number }> {
	const existing = await listFaqsAdmin(client, facilityId);
	const seen = new Set(existing.map((f) => normalize(f.question)));
	let added = 0;
	let skipped = 0;
	for (const it of items) {
		const key = normalize(it.question);
		if (!it.question.trim() || seen.has(key)) {
			skipped++;
			continue;
		}
		await addFaqAdmin(client, facilityId, {
			category: it.category,
			question: it.question.trim(),
			answer: it.answer.trim(),
			keywords: it.keywords ?? [],
			source: it.source,
			isPublished: false
		});
		seen.add(key);
		added++;
	}
	return { added, skipped };
}
