<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { route, title }: { route: string; title: string } = $props();
</script>

{#snippet rows(count: number)}
	<div class="divide-y divide-stone-100">
		{#each Array(count) as _, i (i)}
			<div class="flex items-center justify-between gap-3 py-2">
				<div class="shimmer h-3 w-24 rounded"></div>
				<div class="shimmer h-3 w-28 rounded"></div>
			</div>
		{/each}
	</div>
{/snippet}

{#snippet buttons(pair: boolean)}
	<div class="flex gap-3">
		{#if pair}<div class="shimmer h-11 flex-1 rounded-xl"></div>{/if}
		<div class="shimmer h-11 flex-[2] rounded-xl"></div>
	</div>
{/snippet}

<p role="status" class="sr-only">{title} · {m.common_loading()}</p>
<div class="space-y-4" aria-hidden="true" data-checkin-loading={route}>
	{#if route === '/ci/meals'}
		<div class="space-y-2 pt-0.5">
			<div class="shimmer h-3 w-full rounded"></div>
			<div class="shimmer h-3 w-2/3 rounded"></div>
		</div>
		<div class="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
			<div class="shimmer h-3 w-24 rounded"></div>
			{#each [0, 1] as i (i)}
				<div class="grid grid-cols-[5.5rem_1fr] items-center gap-3">
					<div class="space-y-1.5"><div class="shimmer h-3 w-12 rounded"></div><div class="shimmer h-2.5 w-9 rounded"></div></div>
					<div class="space-y-1.5"><div class="shimmer h-10 rounded-lg"></div><div class="shimmer h-2.5 w-28 rounded"></div></div>
				</div>
			{/each}
		</div>
		{@render buttons(true)}
	{:else if route === '/ci/bath'}
		<div class="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
			<div class="shimmer h-4 w-28 rounded"></div>
			<div class="shimmer h-3 w-4/5 rounded"></div>
			<div class="space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200">
				<div class="shimmer h-3 w-28 rounded"></div>
				<div class="shimmer h-3 w-2/3 rounded"></div>
			</div>
			<div class="shimmer h-3 w-24 rounded"></div>
			<div class="grid grid-cols-2 gap-2">
				{#each [0, 1, 2, 3] as i (i)}<div class="shimmer h-10 rounded-lg"></div>{/each}
			</div>
		</div>
		{@render buttons(true)}
	{:else if route === '/ci/done'}
		<div class="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
			<div class="shimmer h-4 w-40 rounded"></div>
			{@render rows(3)}
		</div>
		{@render buttons(false)}
	{:else}
		<div class="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
			<div class="shimmer h-4 w-28 rounded"></div>
			{@render rows(4)}
		</div>
		<div class="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
			<div class="shimmer h-4 w-24 rounded"></div>
			<div class="shimmer h-10 rounded-lg"></div>
			<div class="shimmer h-10 rounded-lg"></div>
		</div>
	{/if}
</div>
