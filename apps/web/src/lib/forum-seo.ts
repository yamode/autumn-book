// コミュニティを検索エンジン・AI 検索の情報源として読みやすくする（AIO・2026-11-23）。
// - 各スレッドに要約（meta description）・正規 URL・schema.org の DiscussionForumPosting を付ける
// - 板・トップは CollectionPage（スレッドの一覧）
// - 書き込みは利用者の文章なので、JSON-LD に入れるときは </script> で抜けられないよう < > & を \u 形式にする
import type { ForumPostView, ForumThreadListItem } from '$lib/types';

export const FORUM_PUBLISHER = { '@type': 'Organization', name: '株式会社山人', alternateName: 'YAMADO', url: 'https://book.yamado.app/' } as const;

/** 本文から要約を作る（>>n の引用番号と URL を除き、空白を詰めて max 文字まで） */
export function forumExcerpt(body: string, max = 140): string {
	const text = body
		.replace(/>>\d{1,4}/g, '')
		.replace(/https?:\/\/\S+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const chars = [...text];
	return chars.length <= max ? text : chars.slice(0, max - 1).join('').trimEnd() + '…';
}

/** <script type="application/ld+json"> の中身として安全な JSON */
export function jsonLdScript(data: unknown): string {
	const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
	return `<script type="application/ld+json">${json}<\/script>`;
}

function author(post: Pick<ForumPostView, 'nickname' | 'isStaff'>) {
	return post.isStaff
		? { '@type': 'Organization', name: post.nickname ? `${post.nickname}（山人スタッフ）` : '山人スタッフ', url: FORUM_PUBLISHER.url }
		: { '@type': 'Person', name: post.nickname ?? '会員' };
}

export interface ThreadSeoInput {
	url: string;
	boardUrl: string;
	boardTitle: string;
	title: string;
	createdAt: string;
	lastPostedAt: string;
	posts: ForumPostView[];
}

/** スレッドの DiscussionForumPosting。1番目の投稿が本文、2番目以降が comment */
export function threadJsonLd(t: ThreadSeoInput) {
	const visible = t.posts.filter((p) => !p.isDeleted && p.body);
	const first = visible.find((p) => p.postNo === 1) ?? visible[0];
	const replies = visible.filter((p) => p !== first);
	return {
		'@context': 'https://schema.org',
		'@type': 'DiscussionForumPosting',
		'@id': t.url,
		url: t.url,
		mainEntityOfPage: t.url,
		headline: t.title,
		inLanguage: 'ja',
		...(first ? { text: first.body, author: author(first) } : {}),
		datePublished: first?.createdAt ?? t.createdAt,
		dateModified: t.lastPostedAt,
		isPartOf: { '@type': 'WebPage', name: t.boardTitle, url: t.boardUrl },
		publisher: FORUM_PUBLISHER,
		interactionStatistic: {
			'@type': 'InteractionCounter',
			interactionType: 'https://schema.org/CommentAction',
			userInteractionCount: replies.length
		},
		comment: replies.map((p) => ({
			'@type': 'Comment',
			url: `${t.url}#post-${p.postNo}`,
			text: p.body,
			datePublished: p.createdAt,
			author: author(p)
		}))
	};
}

/** スレッドの説明（1番目の投稿の要約。無ければ板の名前） */
export function threadDescription(title: string, boardTitle: string, posts: ForumPostView[]): string {
	const first = posts.find((p) => !p.isDeleted && p.body);
	return first ? forumExcerpt(first.body) : `${boardTitle}の話題「${title}」`;
}

/** 板・トップのスレッド一覧（CollectionPage + ItemList） */
export function threadListJsonLd(page: { url: string; name: string; description: string }, threads: Pick<ForumThreadListItem, 'id' | 'title'>[], origin: string) {
	return {
		'@context': 'https://schema.org',
		'@type': 'CollectionPage',
		'@id': page.url,
		url: page.url,
		name: page.name,
		description: page.description,
		inLanguage: 'ja',
		publisher: FORUM_PUBLISHER,
		mainEntity: {
			'@type': 'ItemList',
			itemListElement: threads.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.title, url: `${origin}/community/threads/${t.id}` }))
		}
	};
}
