// GET /api/faq/{facility}?locale=ja … 公開 FAQ の一覧（カテゴリ別・よく見られている質問）。回答本文は含めない（軽量）。
// 設計書 autumn_book_faq_bot_design.md §5
import type { RequestHandler } from './$types';
import { DEFAULT_ANSWER_THRESHOLD } from '$lib/server/faq/search';
import { corsHeaders, facilityBySlug, faqJson, fallbackFor, loadPublicFaqs, parseLocale } from '$lib/server/faq/public';

export const OPTIONS: RequestHandler = ({ request, params }) =>
	new Response(null, { status: 204, headers: corsHeaders(request, params.facility) });

export const GET: RequestHandler = async ({ request, params, url }) => {
	const f = facilityBySlug(params.facility);
	if (!f) return faqJson(request, params.facility, { error: 'not_found' }, { status: 404 });
	const locale = parseLocale(url.searchParams.get('locale'));

	try {
		const items = await loadPublicFaqs(f.uuid, locale);
		const byCat = new Map<string, { id: string; question: string }[]>();
		for (const i of items) {
			const list = byCat.get(i.category) ?? [];
			list.push({ id: i.id, question: i.question });
			byCat.set(i.category, list);
		}
		return faqJson(
			request,
			params.facility,
			{
				locale,
				categories: [...byCat].map(([name, list]) => ({ name, items: list })),
				fallback: fallbackFor(params.facility),
				threshold: DEFAULT_ANSWER_THRESHOLD
			},
			{ cache: 'public, max-age=300' }
		);
	} catch (e) {
		console.error('faq list error:', e instanceof Error ? e.message : String(e));
		return faqJson(request, params.facility, { error: 'unavailable' }, { status: 503 });
	}
};
