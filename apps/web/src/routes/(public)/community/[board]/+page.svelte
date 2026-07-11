<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDate } from '$lib/format';
	import ForumCta from '$lib/components/ForumCta.svelte';

	let { data } = $props();
</script>

<svelte:head><title>{data.board.title} ｜ {m.forum_title()}</title></svelte:head>

<div class="forum-shell mx-auto max-w-3xl px-4 py-10">
	<nav class="mb-3 text-xs text-stone-400">
		<a href="/community" class="hover:underline">{m.forum_board_breadcrumb()}</a> / {data.board.title}
	</nav>

	<div class="mb-5 flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-2xl text-brand-900">{data.board.title}</h1>
			<p class="mt-1 text-sm text-stone-500">{data.board.description}</p>
		</div>
		{#if !data.board.isArchived && data.writeEnabled}
			{#if data.isLoggedIn}
				<a href="/community/{data.board.slug}/new" class="shrink-0 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500">{m.forum_new_thread()}</a>
			{:else}
				<a href="/auth/login?next={encodeURIComponent(`/community/${data.board.slug}/new`)}" class="shrink-0 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">{m.forum_cta_login()}</a>
			{/if}
		{/if}
	</div>

	{#if data.board.isArchived}
		<p class="mb-4 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">{m.forum_archived_notice()}</p>
	{/if}

	{#if !data.writeEnabled}
		<div class="mb-6 rounded-2xl border border-brand-200 bg-brand-50 p-4 sm:p-5">
			<p class="font-medium text-brand-900">{m.forum_write_app_only_heading()}</p>
			<p class="mt-1 text-sm text-stone-700">{m.forum_write_app_only()}</p>
		</div>
	{/if}

	{#if !data.isLoggedIn}
		<ForumCta showBanner={true} facilities={[]} />
	{/if}

	{#if data.threads.length === 0}
		<p class="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">{m.forum_no_threads()}</p>
	{:else}
		<ul class="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
			{#each data.threads as t}
				<li>
					<a href="/community/threads/{t.id}" class="flex flex-col gap-1 px-4 py-3 hover:bg-stone-50 sm:flex-row sm:items-center sm:gap-4">
						<span class="flex min-w-0 flex-1 items-center gap-1.5">
							{#if t.isPinned}<span title="pinned">📌</span>{/if}
							{#if t.isLocked}<span title="locked">🔒</span>{/if}
							<span class="truncate text-sm font-medium text-brand-900">{t.title}</span>
						</span>
						<span class="flex shrink-0 items-center gap-3 text-xs text-stone-400">
							<span class="inline-flex items-center gap-1">
								{t.authorNickname}
								{#if t.authorIsStaff}<span class="rounded bg-brand-800 px-1 py-0.5 text-[10px] font-medium text-white">{m.forum_staff_badge()}</span>{/if}
							</span>
							<span class="tabular-nums">{m.forum_replies_count({ n: t.replyCount })}</span>
							<span class="tabular-nums">{formatDate(t.lastPostedAt.slice(0, 10))}</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>

		{#if data.totalPages > 1}
			<div class="mt-4 flex items-center justify-center gap-3 text-sm">
				{#if data.page > 1}
					<a href="?page={data.page - 1}" class="rounded-md border border-stone-300 px-3 py-1.5 hover:bg-stone-50">{m.forum_page_prev()}</a>
				{/if}
				<span class="tabular-nums text-stone-500">{m.forum_page_indicator({ page: data.page, total: data.totalPages })}</span>
				{#if data.page < data.totalPages}
					<a href="?page={data.page + 1}" class="rounded-md border border-stone-300 px-3 py-1.5 hover:bg-stone-50">{m.forum_page_next()}</a>
				{/if}
			</div>
		{/if}
	{/if}

	<ForumCta showBanner={false} facilities={data.facilities} />
</div>
