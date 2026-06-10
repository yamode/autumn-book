<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
</script>

<svelte:head><title>{m.favorites_title()}</title></svelte:head>

<section>
	<h2 class="mb-3 font-medium text-brand-900">{m.favorites_heading()}</h2>
	<div class="grid gap-4 sm:grid-cols-2">
		{#each data.favorites as f}
			<div class="overflow-hidden rounded-2xl border border-stone-200 bg-white">
				<a href="/{f.brandSlug}/{f.slug}">
					<img src={f.photos[0].url} alt={f.name} class="h-40 w-full object-cover" />
				</a>
				<div class="flex items-center justify-between p-4">
					<div>
						<p class="text-xs text-stone-400">{f.prefecture}</p>
						<a href="/{f.brandSlug}/{f.slug}" class="font-display text-lg text-brand-900 hover:underline">{f.name}</a>
					</div>
					<form method="POST" action="?/toggle" use:enhance>
						<input type="hidden" name="facilityId" value={f.id} />
						<button type="submit" class="text-xl text-red-500 hover:scale-110" title={m.favorites_remove()}>♥</button>
					</form>
				</div>
			</div>
		{:else}
			<p class="col-span-full rounded-2xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">{m.favorites_empty()}</p>
		{/each}
	</div>
</section>

{#if data.others.length > 0}
	<section class="mt-8">
		<h2 class="mb-3 font-medium text-brand-900">{m.favorites_others()}</h2>
		<div class="grid gap-4 sm:grid-cols-2">
			{#each data.others as f}
				<div class="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-3">
					<img src={f.photos[0].url} alt="" class="h-14 w-20 rounded-lg object-cover" />
					<a href="/{f.brandSlug}/{f.slug}" class="flex-1 text-sm font-medium text-brand-900 hover:underline">{f.name}</a>
					<form method="POST" action="?/toggle" use:enhance>
						<input type="hidden" name="facilityId" value={f.id} />
						<button type="submit" class="text-xl text-stone-300 hover:text-red-400" title={m.favorites_add()}>♡</button>
					</form>
				</div>
			{/each}
		</div>
	</section>
{/if}
