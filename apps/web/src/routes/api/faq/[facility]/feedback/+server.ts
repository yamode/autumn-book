// POST /api/faq/{facility}/feedback  { queryId, faqId?, helpful? }
// 検索結果のクリックと「解決した／しなかった」を記録する（評価は1回だけ・24時間以内のログに限る＝RPC 側で担保）。
import type { RequestHandler } from './$types';
import { supa } from '$lib/server/supabase';
import { allowRequest, corsHeaders, facilityBySlug, faqJson } from '$lib/server/faq/public';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const OPTIONS: RequestHandler = ({ request, params }) =>
	new Response(null, { status: 204, headers: corsHeaders(request, params.facility) });

export const POST: RequestHandler = async ({ request, params, platform, getClientAddress }) => {
	const slug = params.facility;
	if (!facilityBySlug(slug)) return faqJson(request, slug, { error: 'not_found' }, { status: 404 });

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return faqJson(request, slug, { error: 'bad_request' }, { status: 400 });
	}
	const queryId = typeof body.queryId === 'string' && UUID.test(body.queryId) ? body.queryId : null;
	const faqId = typeof body.faqId === 'string' && UUID.test(body.faqId) ? body.faqId : null;
	const helpful = typeof body.helpful === 'boolean' ? body.helpful : null;
	if (!queryId || (faqId === null && helpful === null)) return faqJson(request, slug, { error: 'bad_request' }, { status: 400 });

	const ip = request.headers.get('cf-connecting-ip') ?? getClientAddress();
	if (!(await allowRequest(platform?.env?.AB_RATE, `feedback:${ip}`, 60, 600))) {
		return faqJson(request, slug, { error: 'rate_limited' }, { status: 429 });
	}

	const { error } = await supa().rpc('faq_feedback', { p_query_id: queryId, p_clicked_faq_id: faqId, p_helpful: helpful });
	if (error) {
		console.error('faq_feedback error:', error.message);
		return faqJson(request, slug, { error: 'unavailable' }, { status: 503 });
	}
	return faqJson(request, slug, { ok: true });
};
