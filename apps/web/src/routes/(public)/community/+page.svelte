<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDate } from '$lib/format';
	import ForumCta from '$lib/components/ForumCta.svelte';

	let { data } = $props();
</script>

<svelte:head><title>{m.forum_title()} ｜ 山人</title></svelte:head>

<div class="forum-shell mx-auto max-w-5xl px-4 py-10">
	<h1 class="mb-1 text-2xl text-brand-900">{m.forum_title()}</h1>
	<p class="mb-6 text-sm text-stone-500">{m.forum_subtitle()}</p>

	{#if !data.isLoggedIn}
		<ForumCta showBanner={true} facilities={[]} />
	{/if}

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
		<div>
			<h2 class="mb-3 font-medium text-brand-900">{m.forum_boards_heading()}</h2>
			<ul class="space-y-2">
				{#each data.boards as board}
					<li>
						<a href="/community/{board.slug}" class="block rounded-xl border border-stone-200 bg-white p-3 transition hover:shadow-md">
							<div class="flex items-baseline justify-between gap-2">
								<h3 class="truncate text-sm font-medium text-brand-900">
									{board.title}
									{#if board.isArchived}<span class="ml-1 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-normal text-stone-500">archived</span>{/if}
								</h3>
								<span class="shrink-0 text-xs text-stone-400">{m.forum_threads_count({ n: board.threadCount })}</span>
							</div>
							<p class="mt-1 truncate text-xs text-stone-500">{board.description}</p>
						</a>
					</li>
				{/each}
			</ul>
		</div>

		<div>
			<h2 class="mb-3 font-medium text-brand-900">{m.forum_recent_threads_heading()}</h2>
			{#if data.recentThreads.length === 0}
				<p class="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">{m.forum_recent_threads_empty()}</p>
			{:else}
				<ul class="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
					{#each data.recentThreads as t}
						<li>
							<a href="/community/threads/{t.id}" class="flex flex-col gap-1.5 px-4 py-3 hover:bg-stone-50 sm:flex-row sm:items-center sm:gap-4">
								<span class="flex min-w-0 flex-1 items-center gap-2">
									<span class="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">{t.boardTitle}</span>
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
			{/if}
		</div>
	</div>

	<ForumCta showBanner={false} facilities={data.facilities} />
</div>
