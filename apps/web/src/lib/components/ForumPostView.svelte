<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';
	import { renderForumBody } from '$lib/forum-format';
	import { formatDate } from '$lib/format';
	import type { ForumPostView } from '$lib/types';

	// 1投稿の表示。本文は renderForumBody の出力のみ {@html} で描画（エスケープ済み・XSS 不可）。
	let { post, canDelete = false }: { post: ForumPostView; canDelete?: boolean } = $props();

	let html = $derived(post.isDeleted ? '' : renderForumBody(post.body));
	let initial = $derived(post.nickname ? [...post.nickname][0] : '?');
</script>

<article id="post-{post.postNo}" class="scroll-mt-20 border-t border-stone-100 px-4 py-4 first:border-t-0">
	<header class="mb-2 flex flex-wrap items-center gap-2 text-xs text-stone-400">
		<span class="font-mono text-stone-500">{m.forum_post_anchor({ n: post.postNo })}</span>
		{#if !post.isDeleted}
			<span class="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[10px] font-medium text-brand-800">{initial}</span>
			<span class="font-medium text-stone-600">{post.nickname}</span>
			{#if post.isStaff}<span class="rounded bg-brand-800 px-1.5 py-0.5 text-[10px] font-medium text-white">{m.forum_staff_badge()}</span>{/if}
		{/if}
		<time class="tabular-nums">{formatDate(post.createdAt.slice(0, 10))}</time>
		{#if canDelete && post.isOwn && !post.isDeleted}
			<form method="POST" action="?/deletePost" use:enhance class="ml-auto" onsubmit={(e) => { if (!confirm(m.forum_delete_confirm())) e.preventDefault(); }}>
				<input type="hidden" name="postId" value={post.id} />
				<button type="submit" class="text-xs text-stone-400 hover:text-red-600">{m.forum_delete_post()}</button>
			</form>
		{/if}
	</header>

	{#if post.isDeleted}
		<p class="text-sm italic text-stone-400">{m.forum_deleted_post()}</p>
	{:else}
		<div class="break-words text-sm leading-relaxed text-stone-700">{@html html}</div>
	{/if}
</article>
