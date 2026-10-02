import { fail } from '@sveltejs/kit';
import { faqs, upsertTranslation, translationStore } from '$lib/server/store';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { denyDemoStoreWrite } from '$lib/server/admin-demo-guard';
import { DATA_SOURCE } from '$lib/server/supabase';
import { createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import {
	addFaqAdmin,
	addKeywordToFaq,
	faqStats,
	importSeedFaqs,
	listFaqTranslations,
	listFaqsAdmin,
	listUnansweredGroups,
	parseKeywords,
	saveFaqTranslationAdmin,
	setQueriesStatus,
	updateFaqAdmin,
	type SeedItem
} from '$lib/server/faq/admin';
import { searchFaqs } from '$lib/server/faq/search';
import nishiwagaHpSeed from '$lib/server/faq/seeds/nishiwaga-hp.json';

// FAQ ボット（設計書 autumn_book_faq_bot_design.md §7）。
// DATA_SOURCE=supabase では実データ（book.faqs / book.faq_queries）を、それ以外は従来どおりデモストアを使う。
// 実データ操作には Supabase Auth セッション（管理者ログイン）に紐づいたクライアントが必要（RLS: has_facility_access）。

/** 施設ごとの初期データ（現行サイト・旧ボットから取り出したもの）。取り込みは下書きで登録する */
const SEEDS: Record<string, { label: string; items: SeedItem[] }[]> = {
	[FACILITY_UUID['f-nishiwaga']]: [{ label: '旧HP「よくある質問」ページ（19件）', items: nishiwagaHpSeed.items as SeedItem[] }]
};

function realFacilityId(demoFacilityId: string): string {
	const id = FACILITY_UUID[demoFacilityId];
	if (!id) throw new Error(`FACILITY_UUID に対応がありません: ${demoFacilityId}`);
	return id;
}

/** actions 用: フォームの facilityId（デモ ID）から実施設を決める。他施設を指定されても RLS（has_facility_access）で弾かれる */
function realContext(event: RequestEvent, form: FormData) {
	return { client: createSupabaseServerClient(event), facilityId: realFacilityId(String(form.get('facilityId') ?? '')) };
}

function str(form: FormData, key: string): string {
	return String(form.get(key) ?? '').trim();
}
function ids(form: FormData): string[] {
	return str(form, 'queryIds').split(',').filter((s) => /^[0-9a-f-]{36}$/i.test(s));
}
function errMsg(e: unknown, fallback: string) {
	return fail(500, { message: e instanceof Error ? e.message : fallback });
}

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();

	if (DATA_SOURCE === 'supabase') {
		const client = createSupabaseServerClient(event);
		const facilityId = realFacilityId(currentFacility.id);
		const list = await listFaqsAdmin(client, facilityId);
		const [faqTranslations, groups, stats] = await Promise.all([
			listFaqTranslations(client, list.map((f) => f.id)),
			listUnansweredGroups(client, facilityId),
			faqStats(client, facilityId)
		]);
		// 検索テスト（?test=質問文）: 公開・下書きを問わず現在の FAQ で照合し、スコアを見せる
		const testQuery = event.url.searchParams.get('test')?.trim() ?? '';
		const testResults = testQuery
			? searchFaqs(testQuery, list, 'ja', 5).map((h) => ({ id: h.faq.id, question: h.faq.question, score: h.score }))
			: [];
		const seeds = (SEEDS[facilityId] ?? []).map((s, i) => ({ index: i, label: s.label, count: s.items.length }));
		return { real: true, faqs: list, faqTranslations, groups, stats, testQuery, testResults, seeds };
	}

	const facilityFaqs = faqs.filter((q) => q.facilityId === currentFacility.id).sort((a, b) => a.sortOrder - b.sortOrder);
	const faqTranslations = Object.fromEntries(
		facilityFaqs.map((q) => {
			const trMap = translationStore.get(`faq:${q.id}`);
			return [q.id, { en: trMap?.get('en') ?? null, 'zh-TW': trMap?.get('zh-TW') ?? null }];
		})
	);
	return {
		real: false,
		faqs: facilityFaqs.map((q) => ({ ...q, keywords: [] as string[], source: 'manual', viewCount: 0 })),
		faqTranslations,
		groups: [],
		stats: null,
		testQuery: '',
		testResults: [],
		seeds: []
	};
};

export const actions: Actions = {
	save: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await event.request.formData();
		const question = str(form, 'question');
		if (!question) return fail(400, { message: '質問を入力してください' });

		if (DATA_SOURCE === 'supabase') {
			const { client } = realContext(event, form);
			try {
				await updateFaqAdmin(client, str(form, 'faqId'), {
					category: str(form, 'category'),
					question,
					answer: String(form.get('answer') ?? ''),
					keywords: parseKeywords(String(form.get('keywords') ?? '')),
					isPublished: form.get('isPublished') === 'on',
					sortOrder: Number(form.get('sortOrder') ?? 0) || 0
				});
			} catch (e) {
				return errMsg(e, '保存に失敗しました');
			}
			return { saved: str(form, 'faqId') };
		}

		const blocked = denyDemoStoreWrite();
		if (blocked) return blocked;
		const faq = faqs.find((q) => q.id === str(form, 'faqId'));
		if (!faq) return fail(404, {});
		faq.category = String(form.get('category') ?? faq.category);
		faq.question = question;
		faq.answer = String(form.get('answer') ?? faq.answer);
		faq.isPublished = form.get('isPublished') === 'on';
		return { saved: faq.id };
	},

	add: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await event.request.formData();
		const question = str(form, 'question');
		if (!question) return fail(400, { message: '質問を入力してください' });

		if (DATA_SOURCE === 'supabase') {
			const { client, facilityId } = realContext(event, form);
			const queryIds = ids(form);
			try {
				const created = await addFaqAdmin(client, facilityId, {
					category: str(form, 'category'),
					question,
					answer: String(form.get('answer') ?? ''),
					keywords: parseKeywords(String(form.get('keywords') ?? '')),
					source: queryIds.length ? 'from_query' : 'manual',
					isPublished: form.get('isPublished') === 'on'
				});
				// 「未回答の質問」から作成した場合は、まとめた質問を対応済みにする
				if (queryIds.length) await setQueriesStatus(client, queryIds, 'resolved', created.id);
			} catch (e) {
				return errMsg(e, '追加に失敗しました');
			}
			return { added: true };
		}

		const blocked = denyDemoStoreWrite();
		if (blocked) return blocked;
		const facilityId = str(form, 'facilityId');
		faqs.push({
			id: `q-${Date.now()}`,
			facilityId,
			category: str(form, 'category') || 'その他',
			question,
			answer: String(form.get('answer') ?? ''),
			isPublished: false,
			sortOrder: faqs.filter((q) => q.facilityId === facilityId).length + 1
		});
		return { added: true };
	},

	saveTranslation: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await event.request.formData();
		const faqId = str(form, 'faqId');
		const locale = str(form, 'locale') as 'en' | 'zh-TW';
		if (!['en', 'zh-TW'].includes(locale)) return fail(400, { message: '無効なロケールです' });
		const isPublished = form.get('isPublished') === 'on';
		const fields = {
			category: str(form, 'category'),
			question: str(form, 'question'),
			answer: String(form.get('answer') ?? ''),
			keywords: parseKeywords(String(form.get('keywords') ?? ''))
		};

		if (DATA_SOURCE === 'supabase') {
			const { client, facilityId } = realContext(event, form);
			try {
				await saveFaqTranslationAdmin(client, facilityId, faqId, locale, fields, isPublished);
			} catch (e) {
				return errMsg(e, '翻訳の保存に失敗しました');
			}
			return { translationSaved: faqId };
		}

		const blocked = denyDemoStoreWrite();
		if (blocked) return blocked;
		upsertTranslation('faq', faqId, locale, fields, isPublished);
		return { translationSaved: faqId };
	},

	/** 未回答の質問を既存 FAQ に紐付け（質問文を言い換えに追加し、対応済みにする） */
	linkQuery: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		if (DATA_SOURCE !== 'supabase') return fail(400, { message: '本番データでのみ利用できます' });
		const form = await event.request.formData();
		const faqId = str(form, 'faqId');
		if (!faqId) return fail(400, { message: '紐付ける FAQ を選んでください' });
		const { client } = realContext(event, form);
		try {
			await addKeywordToFaq(client, faqId, str(form, 'phrase'));
			await setQueriesStatus(client, ids(form), 'resolved', faqId);
		} catch (e) {
			return errMsg(e, '紐付けに失敗しました');
		}
		return { linked: true };
	},

	/** 未回答の質問を対象外にする */
	ignoreQuery: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		if (DATA_SOURCE !== 'supabase') return fail(400, { message: '本番データでのみ利用できます' });
		const form = await event.request.formData();
		const { client } = realContext(event, form);
		try {
			await setQueriesStatus(client, ids(form), 'ignored');
		} catch (e) {
			return errMsg(e, '更新に失敗しました');
		}
		return { ignored: true };
	},

	/** 初期データの取り込み（下書きで登録・同じ質問は飛ばす） */
	importSeed: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		if (DATA_SOURCE !== 'supabase') return fail(400, { message: '本番データでのみ利用できます' });
		const form = await event.request.formData();
		const { client, facilityId } = realContext(event, form);
		const seed = (SEEDS[facilityId] ?? [])[Number(form.get('index'))];
		if (!seed) return fail(404, { message: '初期データが見つかりません' });
		try {
			const r = await importSeedFaqs(client, facilityId, seed.items);
			return { imported: r };
		} catch (e) {
			return errMsg(e, '取り込みに失敗しました');
		}
	}
};
