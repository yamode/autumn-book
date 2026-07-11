<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
</script>

<svelte:head><title>{m.favorites_title()}</title></svelte:head>

<div class="space-y-8">
	<div>
		<h2 class="text-lg">{m.favorites_rooms_heading()}</h2>
		<p class="mt-1 text-sm text-stone-500">{m.favorites_rooms_sub()}</p>
	</div>

	{#each data.facilities as f}
		<section class="overflow-hidden rounded-2xl border border-stone-200 bg-white">
			<div class="flex items-center gap-3 border-b border-stone-100 p-4">
				{#if f.photo}<img src={f.photo} alt="" class="h-14 w-20 rounded-lg object-cover" />{/if}
				<div class="min-w-0 flex-1">
					<a href="/{f.brandSlug}/{f.slug}" class="text-lg font-semibold text-brand-900 hover:underline">{f.name}</a>
					<p class="text-sm text-stone-400">{f.prefecture}</p>
				</div>
				{#if f.favCount > 0}
					<span class="shrink-0 rounded-full bg-red-50 px-2.5 py-1 text-sm font-medium text-red-600">♥ {f.favCount}</span>
				{/if}
			</div>

			{#if f.rooms.length > 0}
				<div class="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2">
					{#each f.rooms as r}
						<form method="POST" action="?/toggle" use:enhance>
							<input type="hidden" name="roomId" value={r.roomId} />
							<button
								type="submit"
								aria-pressed={r.favorited}
								title={r.favorited ? m.favorites_remove() : m.favorites_add()}
								class="flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition {r.favorited
									? 'border-red-200 bg-red-50'
									: 'border-stone-200 hover:border-stone-300 hover:bg-stone-50'}"
							>
								<span class="text-xl leading-none {r.favorited ? 'text-red-500' : 'text-stone-300'}">{r.favorited ? '♥' : '♡'}</span>
								<span class="min-w-0 flex-1">
									<span class="block truncate font-medium text-brand-900">{r.name}</span>
									<span class="block truncate text-sm text-stone-400">{r.roomNumber} ・ {r.roomTypeName}</span>
								</span>
							</button>
						</form>
					{/each}
				</div>
			{:else}
				<p class="p-4 text-sm text-stone-400">{m.favorites_rooms_none()}</p>
			{/if}
		</section>
	{:else}
		<p class="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">{m.favorites_empty()}</p>
	{/each}
</div>
