<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDate } from '$lib/format';
	import ForumCta from '$lib/components/ForumCta.svelte';
	import ForumThreadCard from '$lib/components/ForumThreadCard.svelte';
	import { page } from '$app/state';
	import { jsonLdScript, threadListJsonLd } from '$lib/forum-seo';

	let { data } = $props();
	const canonical = $derived(`${page.url.origin}/community`);
	const jsonLd = $derived(jsonLdScript(threadListJsonLd({ url: canonical, name: m.forum_title(), description: m.forum_subtitle() }, data.recentThreads, page.url.origin)));
</script>

<svelte:head>
	<title>{m.forum_title()} ｜ 山人</title>
	<meta name="description" content={m.forum_subtitle()} />
	<link rel="canonical" href={canonical} />
	<meta property="og:title" content={m.forum_title()} />
	<meta property="og:description" content={m.forum_subtitle()} />
	{@html jsonLd}
</svelte:head>

<div class="forum-shell mx-auto max-w-5xl px-4 pb-14 pt-8 sm:pt-12">
	<!-- 見出し（会員特典のページと同じ、英字の小見出し＋明朝の見出し） -->
	<header class="forum-hero">
		<p class="eyebrow">YAMADO COMMUNITY</p>
		<h1 class="hero-title">{m.forum_title()}</h1>
		<p class="mt-3 max-w-xl text-[0.95rem] leading-7 text-stone-600">{m.forum_subtitle()}</p>
		<nav class="mt-5 flex flex-wrap gap-2" aria-label={m.forum_title()}>
			<a href="#recent-threads" class="pill">{m.forum_recent_threads_heading()}</a>
			{#if data.isLoggedIn}
				<a href="/account/community#reply-notifications" class="pill">
					{m.forum_notifications()}
					{#if data.forumUnread}<span class="ml-1.5 rounded-full bg-accent-600 px-2 text-xs font-semibold text-white">{data.forumUnread}</span>{/if}
				</a>
			{/if}
		</nav>
	</header>

	{#if !data.isLoggedIn}
		<ForumCta showBanner={true} facilities={[]} />
	{/if}

	<section aria-labelledby="forum-boards" class="mt-2">
		<h2 id="forum-boards" class="section-title">{m.forum_boards_heading()}</h2>
		<ul class="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.boards as board, i (board.slug)}
				<li>
					<a href="/community/{board.slug}" class="board-item">
						<span class="board-num tabular-nums">{String(i + 1).padStart(2, '0')}</span>
						<span class="board-name break-words">
							{board.title}
							{#if board.isArchived}<span class="ml-1.5 align-middle text-[10px] font-normal text-stone-500">archived</span>{/if}
						</span>
						<span class="mt-1 line-clamp-2 break-words text-sm leading-6 text-stone-600">{board.description}</span>
						<span class="mt-auto flex flex-wrap gap-x-3 pt-3 text-xs text-stone-500">
							<span class="tabular-nums">{m.forum_threads_count({ n: board.threadCount })}</span>
							{#if board.lastPostedAt}<time datetime={board.lastPostedAt} class="tabular-nums">{m.forum_last_posted()} {formatDate(board.lastPostedAt.slice(0, 10))}</time>{/if}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>

	<section aria-labelledby="recent-threads" class="mt-10">
		<div class="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
			<h2 id="recent-threads" class="section-title mb-0 scroll-mt-24">{m.forum_recent_threads_heading()}</h2>
			<p class="text-xs text-stone-500">{m.forum_recent_threads_hint()}</p>
		</div>
		{#if data.recentThreads.length === 0}
			<p class="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">{m.forum_recent_threads_empty()}</p>
		{:else}
			<ul class="thread-list">
				{#each data.recentThreads as t (t.id)}
					<li><ForumThreadCard thread={t} boardTitle={t.boardTitle} /></li>
				{/each}
			</ul>
		{/if}
	</section>

	<ForumCta showBanner={false} facilities={data.facilities} />
</div>
