// お知らせ公開 API の共通部品。施設HP（Xserver 上の PHP）がサーバー側から呼んで、一覧・詳細を描画する。
// 認証なし・読み取りのみ（RLS で公開分だけが返る）。施設の識別子は FAQ と同じ（oga / nishiwaga）。
import { json } from '@sveltejs/kit';
import { supa } from '$lib/server/supabase';
import { renderMarkdown } from '$lib/markdown';
import { corsHeaders, facilityBySlug } from '$lib/server/faq/public';

export { facilityBySlug };

export function newsJson(request: Request, slug: string, body: unknown, init: { status?: number; cache?: string } = {}) {
	return json(body, {
		status: init.status ?? 200,
		headers: { ...corsHeaders(request, slug), 'cache-control': init.cache ?? 'public, max-age=60' }
	});
}

/** 本文 Markdown → HTML。本文中のリンクは新しいタブで開く（生 HTML はエスケープ済みなので、残る <a> は marked が生成したものだけ） */
export function newsBodyHtml(md: string): string {
	return renderMarkdown(md).replace(/<a\s/g, '<a target="_blank" rel="noopener noreferrer" ');
}

export interface NewsRow {
	id: string;
	title: string;
	body: string;
	published_at: string;
}

export async function listPublicNews(facilityUuid: string, page: number, per: number) {
	const from = (page - 1) * per;
	const { data, error, count } = await supa()
		.from('news_posts')
		.select('id, title, body, published_at', { count: 'exact' })
		.eq('facility_id', facilityUuid)
		.eq('is_published', true)
		.order('published_at', { ascending: false })
		.order('created_at', { ascending: false })
		.range(from, from + per - 1);
	if (error) throw error;
	const total = count ?? 0;
	return { rows: (data ?? []) as NewsRow[], total, totalPages: Math.max(1, Math.ceil(total / per)) };
}

export async function getPublicNews(facilityUuid: string, id: string) {
	const { data: post, error } = await supa()
		.from('news_posts')
		.select('id, title, body, published_at')
		.eq('facility_id', facilityUuid)
		.eq('is_published', true)
		.eq('id', id)
		.maybeSingle();
	if (error) throw error;
	if (!post) return null;
	const base = () => supa().from('news_posts').select('id, title').eq('facility_id', facilityUuid).eq('is_published', true);
	const [{ data: prev }, { data: next }] = await Promise.all([
		base().lt('published_at', post.published_at).order('published_at', { ascending: false }).limit(1).maybeSingle(),
		base().gt('published_at', post.published_at).order('published_at', { ascending: true }).limit(1).maybeSingle()
	]);
	return { post: post as NewsRow, prev: (prev as { id: string; title: string } | null) ?? null, next: (next as { id: string; title: string } | null) ?? null };
}
