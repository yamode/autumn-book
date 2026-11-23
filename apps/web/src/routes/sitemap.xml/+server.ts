// サイトマップ（2026-11-23・AIO）。検索エンジンと AI 検索のクローラーに、公開ページとコミュニティの全スレッドを知らせる。
// 予約手続き・マイページ・取引先ページ（/p/）など、個人の情報があるページは載せない。
import { getPublishedFacilities, listForumBoards, listForumThreads } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { listForumBoardsData, listForumThreadsData } from '$lib/server/supabase-data';
import type { ForumThreadListItem } from '$lib/types';
import type { RequestHandler } from './$types';

const PER = 100;
const MAX_PAGES = 50;

type Entry = { path: string; lastmod?: string | null };

async function boardThreads(board: { id: string; slug: string }): Promise<ForumThreadListItem[]> {
	const out: ForumThreadListItem[] = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		const { threads, total } = DATA_SOURCE === 'supabase'
			? await listForumThreadsData(board.slug, page, PER)
			: listForumThreads(board.id, page, PER);
		out.push(...threads);
		if (out.length >= total || threads.length < PER) break;
	}
	return out;
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: RequestHandler = async ({ url }) => {
	const entries: Entry[] = [{ path: '/' }, { path: '/membership' }, { path: '/kitakaze' }, { path: '/community' }];
	for (const f of getPublishedFacilities('ja')) {
		// 施設のページ（/brand/facility）は一旦非公開＝プラン一覧へ転送するので載せない（2026-11-23）
		entries.push({ path: `/${f.brandSlug}/${f.slug}/plans` }, { path: `/${f.brandSlug}/${f.slug}/rooms` });
	}
	const boards = DATA_SOURCE === 'supabase' ? await listForumBoardsData() : listForumBoards();
	for (const board of boards) {
		entries.push({ path: `/community/${board.slug}`, lastmod: board.lastPostedAt });
		for (const t of await boardThreads(board)) entries.push({ path: `/community/threads/${t.id}`, lastmod: t.lastPostedAt });
	}
	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `  <url><loc>${escapeXml(url.origin + e.path)}</loc>${e.lastmod ? `<lastmod>${escapeXml(e.lastmod)}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
	return new Response(body, {
		headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' }
	});
};
