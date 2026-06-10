<script lang="ts">
	import type { NewsPost } from '$lib/types';
	import * as m from '$lib/paraglide/messages';
	import { formatDate } from '$lib/format';

	let {
		news,
		base,
		heading = '',
		variant = 'standard'
	}: { news: NewsPost[]; base: string; heading?: string; variant?: 'standard' | 'yamado' | 'oga' } = $props();
</script>

{#if news.length > 0}
	<section>
		<div class="mb-4 flex items-end justify-between">
			{#if variant === 'oga'}
				<h2 class="text-sm font-semibold tracking-[0.3em] text-stone-400">NEWS</h2>
			{:else}
				<h2 class="font-display text-2xl" style="color: var(--fac-heading, #1f1d15)">{heading || m.news_title()}</h2>
			{/if}
			<a href="{base}/news" class="text-sm underline-offset-4 hover:underline" style="color: var(--fac-accent, #95742c)">{m.news_more()} →</a>
		</div>
		<ul class="divide-y {variant === 'yamado' ? 'divide-stone-300/60' : 'divide-stone-200'}">
			{#each news as n}
				<li>
					<a href="{base}/news/{n.id}" class="group flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-baseline sm:gap-6">
						<time class="shrink-0 tabular-nums {variant === 'oga' ? 'tracking-widest text-stone-400' : 'text-stone-500'}">{formatDate(n.publishedAt)}</time>
						<span class="text-stone-700 group-hover:underline">{n.title}</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}
