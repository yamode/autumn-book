<script lang="ts">
	// コミュニティのスレッド 1 行（トップの「最近の投稿」と板の一覧で共通・2026-11-23）。
	// 左に書いた人の頭文字、中央にタイトルと書いた人・板、右に投稿数と最終投稿日。
	import * as m from '$lib/paraglide/messages';
	import { formatDate } from '$lib/format';
	import type { ForumThreadListItem } from '$lib/types';

	let { thread, boardTitle = null }: { thread: ForumThreadListItem; boardTitle?: string | null } = $props();
	const initial = $derived(thread.authorNickname ? [...thread.authorNickname][0] : '?');
</script>

<a href="/community/threads/{thread.id}" class="thread-card group">
	<span class="avatar {thread.authorIsStaff ? 'avatar-staff' : ''}" aria-hidden="true">{initial}</span>
	<span class="min-w-0 flex-1">
		<span class="flex flex-wrap items-center gap-1.5">
			{#if boardTitle}<span class="chip">{boardTitle}</span>{/if}
			{#if thread.isPinned}<span class="chip chip-pin">{m.forum_label_pinned()}</span>{/if}
			{#if thread.isLocked}<span class="chip chip-muted">{m.forum_label_locked()}</span>{/if}
		</span>
		<span class="title">{thread.title}</span>
		<span class="meta">
			<span class="min-w-0 break-all">{thread.authorNickname}</span>
			{#if thread.authorIsStaff}<span class="staff">{m.forum_staff_badge()}</span>{/if}
			<span aria-hidden="true">·</span>
			<time datetime={thread.lastPostedAt} class="tabular-nums">{formatDate(thread.lastPostedAt.slice(0, 10))}</time>
		</span>
	</span>
	<span class="count" title={m.forum_replies_count({ n: thread.replyCount })}>
		<svg viewBox="0 0 20 20" class="h-4 w-4" aria-hidden="true"><path fill="currentColor" d="M3 5.5A2.5 2.5 0 0 1 5.5 3h9A2.5 2.5 0 0 1 17 5.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-3.6 2.7A.9.9 0 0 1 4 16v-2.1A2.5 2.5 0 0 1 3 11.5v-6Z" /></svg>
		<span class="tabular-nums">{thread.replyCount}</span>
		<span class="sr-only">{m.forum_replies_count({ n: thread.replyCount })}</span>
	</span>
</a>

<style>
	.thread-card {
		display: flex;
		align-items: flex-start;
		gap: 0.875rem;
		padding: 1.125rem 0.25rem;
	}
	.thread-card:focus-visible { outline: 2px solid #78603b; outline-offset: 2px; }
	.avatar {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
		border-radius: 9999px;
		background: var(--color-brand-100);
		color: var(--color-brand-800);
		font-size: 0.95rem;
		font-weight: 600;
	}
	.avatar-staff { background: var(--color-brand-800); color: #fff; }
	.title {
		display: block;
		margin-top: 0.15rem;
		color: var(--color-brand-900);
		font-weight: 600;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.thread-card:hover .title { text-decoration-line: underline; text-decoration-thickness: 1px; text-underline-offset: 0.3em; }
	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		margin-top: 0.25rem;
		color: #6b6459;
		font-size: 0.8125rem;
	}
	.chip {
		display: inline-flex;
		padding: 0.05rem 0.55rem;
		border-radius: 9999px;
		background: var(--color-brand-50);
		border: 1px solid var(--color-brand-100);
		color: var(--color-brand-700);
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.chip-pin { background: #fcf6e7; border-color: #ecdcb5; color: #7a5d22; }
	.chip-muted { background: #f5f5f4; border-color: #e7e5e4; color: #78716c; }
	.staff {
		padding: 0 0.4rem;
		border-radius: 0.35rem;
		background: var(--color-brand-800);
		color: #fff;
		font-size: 0.625rem;
		font-weight: 600;
		line-height: 1.6;
	}
	.count {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		align-self: center;
		flex-shrink: 0;
		color: #8a8377;
		font-size: 0.8125rem;
	}
</style>
