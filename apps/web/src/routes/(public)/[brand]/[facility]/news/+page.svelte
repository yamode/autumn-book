<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDate } from '$lib/format';

	let { data } = $props();
	let base = $derived(`/${data.facility.brandSlug}/${data.facility.slug}`);
</script>

<svelte:head><title>{m.news_title()} ｜ {data.facility.name}</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-10">
	<nav class="mb-4 text-xs text-stone-400">
		<a href={base} class="hover:underline">{data.facility.name}</a> / {m.news_title()}
	</nav>
	<h1 class="font-display mb-8 text-2xl text-brand-900">{m.news_title()}</h1>

	{#if data.news.length === 0}
		<p class="text-sm text-stone-500">{m.news_empty()}</p>
	{:else}
		<ul class="divide-y divide-stone-200">
			{#each data.news as n}
				<li>
					<a href="{base}/news/{n.id}" class="group flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:gap-6">
						<time class="shrink-0 text-sm tabular-nums text-stone-500">{formatDate(n.publishedAt)}</time>
						<span class="text-sm text-stone-700 group-hover:underline">{n.title}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
