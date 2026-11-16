<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { title = '', kind = 'page' }: { title?: string; kind?: 'page' | 'videos' } = $props();
</script>

<div data-page-skeleton aria-busy="true" class="min-w-0">
	<p role="status" class="sr-only">{kind === 'videos' ? m.radio_loading() : title ? `${title} · ${m.common_loading()}` : m.common_loading()}</p>
	{#if title && kind !== 'videos'}
		<p class="mb-5 text-xl font-semibold leading-snug text-stone-900 sm:text-2xl">{title}</p>
	{/if}
	{#if kind === 'videos'}
		<div class="grid gap-3 sm:grid-cols-2" aria-hidden="true">
			{#each [0, 1, 2, 3] as card (card)}
				<div class="overflow-hidden rounded-xl border border-stone-200 bg-white">
					<div class="shimmer-block aspect-video w-full rounded-none"></div>
					<div class="space-y-2 p-3">
						<div class="shimmer h-3 w-24 max-w-full"></div>
						<div class="shimmer h-4 w-4/5"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="space-y-4" aria-hidden="true">
			{#if !title}<div class="shimmer mb-5 h-7 w-56 max-w-full"></div>{/if}
			<div class="shimmer h-3.5 w-64 max-w-full"></div>
			{#each [0, 1, 2] as row (row)}
				<div class="space-y-3 rounded-xl border border-stone-200 bg-white px-4 py-4 sm:px-5">
					<div class="shimmer h-4 w-1/2"></div>
					<div class="shimmer h-3 w-4/5"></div>
					<div class="shimmer h-3 w-2/3"></div>
				</div>
			{/each}
		</div>
	{/if}
</div>
