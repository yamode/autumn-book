<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDate } from '$lib/format';
	import ForumCta from '$lib/components/ForumCta.svelte';

	let { data } = $props();
</script>

<svelte:head><title>{m.forum_title()} ｜ 山人</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-10">
	<h1 class="font-display mb-1 text-2xl text-brand-900">{m.forum_title()}</h1>
	<p class="mb-6 text-sm text-stone-500">{m.forum_subtitle()}</p>

	{#if !data.isLoggedIn}
		<ForumCta showBanner={true} facilities={[]} />
	{/if}

	<h2 class="mb-3 font-medium text-brand-900">{m.forum_boards_heading()}</h2>
	<ul class="space-y-3">
		{#each data.boards as board}
			<li>
				<a href="/community/{board.slug}" class="block rounded-2xl border border-stone-200 bg-white p-4 transition hover:shadow-md">
					<div class="flex items-baseline justify-between gap-3">
						<h3 class="font-display text-lg text-brand-900">
							{board.title}
							{#if board.isArchived}<span class="ml-1 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal text-stone-500">archived</span>{/if}
						</h3>
						<span class="shrink-0 text-xs text-stone-400">{m.forum_threads_count({ n: board.threadCount })} {m.forum_threads_count_label()}</span>
					</div>
					<p class="mt-1 text-sm text-stone-600">{board.description}</p>
					<p class="mt-2 text-xs text-stone-400">
						{m.forum_last_posted()}: {board.lastPostedAt ? formatDate(board.lastPostedAt.slice(0, 10)) : m.forum_no_posts_yet()}
					</p>
				</a>
			</li>
		{/each}
	</ul>

	<ForumCta showBanner={false} facilities={data.facilities} />
</div>
