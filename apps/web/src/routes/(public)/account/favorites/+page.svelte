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

			{#if f.types.length > 0}
				<div class="divide-y divide-stone-100">
					{#each f.types as t}
						<!-- 客室タイプごとの折りたたみパネル。お気に入りがある型は初期展開 -->
						<details class="group" open={t.favCount > 0}>
							<summary class="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 hover:bg-stone-50">
								<span class="text-stone-400 transition-transform group-open:rotate-90">▶</span>
								<span class="flex-1 font-medium text-brand-900">{t.name}</span>
								{#if t.favCount > 0}
									<span class="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">♥ {t.favCount}</span>
								{/if}
								<span class="text-sm text-stone-400">{m.favorites_room_count({ n: String(t.rooms.length) })}</span>
							</summary>
							<div class="grid grid-cols-1 gap-2 px-4 pb-4 sm:grid-cols-2">
								{#each t.rooms as r}
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
												<span class="block truncate text-sm text-stone-400">{r.roomNumber}</span>
											</span>
										</button>
									</form>
								{/each}
							</div>
						</details>
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
