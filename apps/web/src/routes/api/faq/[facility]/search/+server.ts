// POST /api/faq/{facility}/search  { q, locale?, page? }
// 登録済み FAQ を検索して上位3件を返し、質問をログに記録する（回答できなかった質問は管理画面で回答・FAQ化する）。
// 設計書 autumn_book_faq_bot_design.md §4・§5
import type { RequestHandler } from './$types';
import { DEFAULT_ANSWER_THRESHOLD, normalize, searchFaqs } from '$lib/server/faq/search';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import {
	allowRequest,
	answerHtml,
	corsHeaders,
	facilityBySlug,
	faqJson,
	fallbackFor,
	loadPublicFaqs,
	parseLocale
} from '$lib/server/faq/public';

export const OPTIONS: RequestHandler = ({ request, params }) =>
	new Response(null, { status: 204, headers: corsHeaders(request, params.facility) });

export const POST: RequestHandler = async ({ request, params, platform, getClientAddress }) => {
	const slug = params.facility;
	const f = facilityBySlug(slug);
	if (!f) return faqJson(request, slug, { error: 'not_found' }, { status: 404 });

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return faqJson(request, slug, { error: 'bad_request' }, { status: 400 });
	}
	const q = typeof body.q === 'string' ? body.q.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) : '';
	if (!q) return faqJson(request, slug, { error: 'empty_query' }, { status: 400 });
	const locale = parseLocale(body.locale);
	const page = typeof body.page === 'string' && body.page.startsWith('/') ? body.page.slice(0, 300) : null;

	// IP あたり 10分30回（IP は記録しない。カウンタのキーにだけ使い、KV は自動で消える）
	const ip = request.headers.get('cf-connecting-ip') ?? getClientAddress();
	if (!(await allowRequest(platform?.env?.AB_RATE, `search:${ip}`, 30, 600))) {
		return faqJson(request, slug, { error: 'rate_limited' }, { status: 429 });
	}

	let items;
	try {
		items = await loadPublicFaqs(f.uuid, locale);
	} catch (e) {
		console.error('faq search load error:', e instanceof Error ? e.message : String(e));
		return faqJson(request, slug, { error: 'unavailable' }, { status: 503 });
	}
	const hits = searchFaqs(q, items, locale, 3);
	const top = hits[0];
	const answered = !!top && top.score >= DEFAULT_ANSWER_THRESHOLD;

	// 質問ログ（失敗しても検索結果は返す）
	// book.faq_log_query は service_role 専用（auth-hardening.md §9・S1）。anon から直接叩いてログを汚せないよう、
	// IP 制限を通したこのサーバからだけ呼ぶ。service_role クライアントの既定スキーマは public なので book を明示する。
	let queryId: string | null = null;
	const sb = partnerServiceClient();
	if (!sb) {
		console.error('faq_log_query error: service_role クライアントが未設定');
	} else {
		const { data, error } = await sb.schema('book').rpc('faq_log_query', {
			p_facility_id: f.uuid,
			p_query: q,
			p_normalized: normalize(q),
			p_top_faq_id: top?.faq.id ?? null,
			p_top_score: top?.score ?? null,
			p_answered: answered,
			p_locale: locale,
			p_page_path: page
		});
		if (error) console.error('faq_log_query error:', error.message);
		else queryId = (data as string) ?? null;
	}

	return faqJson(request, slug, {
		queryId,
		answered,
		results: hits.map((h) => ({ id: h.faq.id, question: h.faq.question, answerHtml: answerHtml(h.faq.answer), score: h.score })),
		fallback: fallbackFor(slug)
	});
};
