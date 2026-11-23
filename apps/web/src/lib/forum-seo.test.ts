// コミュニティの AI 検索向けの情報（$lib/forum-seo.ts）
import { describe, expect, it } from 'vitest';
import { forumExcerpt, jsonLdScript, threadJsonLd } from './forum-seo';
import type { ForumPostView } from './types';

const post = (n: number, body: string, extra: Partial<ForumPostView> = {}): ForumPostView => ({
	id: `p${n}`, postNo: n, body, replyToNo: null, createdAt: `2026-11-0${n}T00:00:00Z`, isDeleted: false, nickname: `user${n}`, avatarUrl: null, isStaff: false, isOwn: false, ...extra
});

describe('forumExcerpt', () => {
	it('引用番号と URL を除き、長い本文は切る', () => {
		expect(forumExcerpt('>>2 露天風呂は\n\n何時まで？ https://x.test/a')).toBe('露天風呂は 何時まで？');
		expect(forumExcerpt('あ'.repeat(200), 10)).toBe('あ'.repeat(9) + '…');
	});
});

describe('jsonLdScript', () => {
	it('利用者の文章で script を閉じられない', () => {
		const html = jsonLdScript({ text: '</script><script>alert(1)</script>' });
		expect(html.match(/<\/script>/g)).toHaveLength(1);
		expect(JSON.parse(html.replace(/^<script[^>]*>|<\/script>$/g, ''))).toEqual({ text: '</script><script>alert(1)</script>' });
	});
});

describe('threadJsonLd', () => {
	it('1番目の投稿が本文、残りが返信。削除済みは入れず、スタッフは宿の名義', () => {
		const ld = threadJsonLd({
			url: 'https://book.yamado.app/community/threads/t1', boardUrl: 'https://book.yamado.app/community/yamado', boardTitle: '西和賀', title: '露天風呂の時間',
			createdAt: '2026-11-01T00:00:00Z', lastPostedAt: '2026-11-03T00:00:00Z',
			posts: [post(1, '何時まで入れますか'), post(2, '', { isDeleted: true, nickname: null }), post(3, '24時までです', { isStaff: true, nickname: '佐藤' })]
		});
		expect(ld.text).toBe('何時まで入れますか');
		expect(ld.author).toEqual({ '@type': 'Person', name: 'user1' });
		expect(ld.comment).toHaveLength(1);
		expect(ld.comment[0]).toMatchObject({ url: 'https://book.yamado.app/community/threads/t1#post-3', text: '24時までです', author: { '@type': 'Organization', name: '佐藤（山人スタッフ）' } });
		expect(ld.interactionStatistic.userInteractionCount).toBe(1);
	});
});
