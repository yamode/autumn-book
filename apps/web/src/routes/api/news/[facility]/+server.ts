// GET /api/news/{facility}?page=1&per=10&body=0 … 公開中のお知らせ一覧（新しい順）。
// body=1 で本文 HTML も返す（一覧に本文を出すページ用）。施設HP（Xserver の PHP）がサーバー側から呼ぶ。
import type { RequestHandler } from './$types';
import { corsHeaders } from '$lib/server/faq/public';
import { facilityBySlug, listPublicNews, newsBodyHtml, newsJson } from '$lib/server/news/public';

export const OPTIONS: RequestHandler = ({ request, params }) =>
	new Response(null, { status: 204, headers: corsHeaders(request, params.facility) });

export const GET: RequestHandler = async ({ request, params, url }) => {
	const f = facilityBySlug(params.facility);
	if (!f) return newsJson(request, params.facility, { error: 'not_found' }, { status: 404 });
	const page = Math.max(1, Math.min(1000, parseInt(url.searchParams.get('page') ?? '1', 10) || 1));
	const per = Math.max(1, Math.min(50, parseInt(url.searchParams.get('per') ?? '10', 10) || 10));
	const withBody = url.searchParams.get('body') === '1';
	try {
		const { rows, total, totalPages } = await listPublicNews(f.uuid, page, per);
		return newsJson(request, params.facility, {
			page,
			per,
			total,
			totalPages,
			items: rows.map((r) => ({ id: r.id, title: r.title, publishedAt: r.published_at, ...(withBody ? { bodyHtml: newsBodyHtml(r.body) } : {}) }))
		});
	} catch (e) {
		console.error('news list error:', e instanceof Error ? e.message : String(e));
		return newsJson(request, params.facility, { error: 'unavailable' }, { status: 503, cache: 'no-store' });
	}
};
