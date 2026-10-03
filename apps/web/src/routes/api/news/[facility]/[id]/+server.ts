// GET /api/news/{facility}/{id} … 公開中のお知らせ1件（本文 HTML）と前後の記事。
import type { RequestHandler } from './$types';
import { corsHeaders } from '$lib/server/faq/public';
import { facilityBySlug, getPublicNews, newsBodyHtml, newsJson } from '$lib/server/news/public';

export const OPTIONS: RequestHandler = ({ request, params }) =>
	new Response(null, { status: 204, headers: corsHeaders(request, params.facility) });

export const GET: RequestHandler = async ({ request, params }) => {
	const f = facilityBySlug(params.facility);
	if (!f || !/^[0-9a-f-]{36}$/i.test(params.id)) return newsJson(request, params.facility, { error: 'not_found' }, { status: 404 });
	try {
		const r = await getPublicNews(f.uuid, params.id);
		if (!r) return newsJson(request, params.facility, { error: 'not_found' }, { status: 404 });
		return newsJson(request, params.facility, {
			post: { id: r.post.id, title: r.post.title, publishedAt: r.post.published_at, bodyHtml: newsBodyHtml(r.post.body) },
			prev: r.prev,
			next: r.next
		});
	} catch (e) {
		console.error('news item error:', e instanceof Error ? e.message : String(e));
		return newsJson(request, params.facility, { error: 'unavailable' }, { status: 503, cache: 'no-store' });
	}
};
