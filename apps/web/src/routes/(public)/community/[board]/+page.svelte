<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import * as m from '$lib/paraglide/messages';
	import ForumThreadCard from '$lib/components/ForumThreadCard.svelte';
	import ForumCta from '$lib/components/ForumCta.svelte';
	import { page } from '$app/state';
	import { canonicalPublicPath } from '$lib/experiments';
	import { jsonLdScript, threadListJsonLd } from '$lib/forum-seo';

	let { data } = $props();
	// 2ページ目以降も、それぞれのページを正規 URL にする
	const canonical = $derived(`${page.url.origin}${canonicalPublicPath(page.url.pathname)}${data.page > 1 ? `?page=${data.page}` : ''}`);
	const description = $derived(data.board.description || `${data.board.title}の話題の一覧`);
	const jsonLd = $derived(jsonLdScript(threadListJsonLd({ url: canonical, name: data.board.title, description }, data.threads, page.url.origin)));
</script>

<svelte:head>
	<title>{data.board.title} ｜ {m.forum_title()}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />
	<meta property="og:title" content={data.board.title} />
	<meta property="og:description" content={description} />
	{@html jsonLd}
</svelte:head>

<div class="forum-shell mx-auto max-w-5xl px-4 pb-14 pt-8 sm:pt-10">
	<BackLink href="/community" target={m.forum_board_breadcrumb()} />

	<header class="forum-hero mt-4 flex flex-wrap items-end justify-between gap-4">
		<div class="min-w-0">
			<p class="eyebrow">COMMUNITY</p>
			<h1 class="hero-title">{data.board.title}</h1>
			{#if data.board.description}<p class="mt-2 max-w-xl text-[0.95rem] leading-7 text-stone-600">{data.board.description}</p>{/if}
		</div>
		{#if !data.board.isArchived && data.writeEnabled}
			{#if data.isLoggedIn && data.rankOk}
				<a href="/community/{data.board.slug}/new" class="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-brand-800 px-5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"><span aria-hidden="true" class="text-base leading-none">＋</span>{m.forum_new_thread()}</a>
			{/if}
		{/if}
	</header>

	{#if data.board.isArchived}
		<p class="mb-4 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">{m.forum_archived_notice()}</p>
	{/if}

	{#if !data.writeEnabled}
		<div class="mb-6 rounded-2xl border border-brand-200 bg-brand-50 p-4 sm:p-5">
			<p class="font-medium text-brand-900">{m.forum_write_app_only_heading()}</p>
			<p class="mt-1 text-sm text-stone-700">{m.forum_write_app_only()}</p>
		</div>
	{/if}

	{#if data.isLoggedIn && !data.rankOk && data.writeEnabled}
		<p class="mb-6 rounded-lg bg-stone-100 px-3 py-2.5 text-sm text-stone-600">{m.forum_rank_required_notice()} <a href="/membership" class="underline">{m.nav_membership()}</a></p>
	{/if}

	{#if !data.isLoggedIn}
		<ForumCta showBanner={true} facilities={[]} />
	{/if}

	{#if data.threads.length === 0}
		<p class="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">{m.forum_no_threads()}</p>
	{:else}
		<ul class="thread-list">
			{#each data.threads as t (t.id)}
				<li><ForumThreadCard thread={t} /></li>
			{/each}
		</ul>

		{#if data.totalPages > 1}
			<div class="mt-4 flex items-center justify-center gap-3 text-sm">
				{#if data.page > 1}
					<a href="?page={data.page - 1}" class="pill">{m.forum_page_prev()}</a>
				{/if}
				<span class="tabular-nums text-stone-500">{m.forum_page_indicator({ page: data.page, total: data.totalPages })}</span>
				{#if data.page < data.totalPages}
					<a href="?page={data.page + 1}" class="pill">{m.forum_page_next()}</a>
				{/if}
			</div>
		{/if}
	{/if}

	<ForumCta showBanner={false} facilities={data.facilities} />
</div>
