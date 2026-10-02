// GET /api/faq/{facility}/item/{id}?locale=ja … 一覧から開いた FAQ の回答（Markdown → サニタイズ済み HTML）
import type { RequestHandler } from './$types';
import { answerHtml, corsHeaders, facilityBySlug, faqJson, loadPublicFaqs, parseLocale } from '$lib/server/faq/public';

export const OPTIONS: RequestHandler = ({ request, params }) =>
	new Response(null, { status: 204, headers: corsHeaders(request, params.facility) });

export const GET: RequestHandler = async ({ request, params, url }) => {
	const f = facilityBySlug(params.facility);
	if (!f) return faqJson(request, params.facility, { error: 'not_found' }, { status: 404 });
	const locale = parseLocale(url.searchParams.get('locale'));
	try {
		const item = (await loadPublicFaqs(f.uuid, locale)).find((i) => i.id === params.id);
		if (!item) return faqJson(request, params.facility, { error: 'not_found' }, { status: 404 });
		return faqJson(
			request,
			params.facility,
			{ id: item.id, category: item.category, question: item.question, answerHtml: answerHtml(item.answer) },
			{ cache: 'public, max-age=300' }
		);
	} catch (e) {
		console.error('faq item error:', e instanceof Error ? e.message : String(e));
		return faqJson(request, params.facility, { error: 'unavailable' }, { status: 503 });
	}
};
