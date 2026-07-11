<script lang="ts">
	import type { Photo } from '$lib/types';

	let { photos }: { photos: Photo[] } = $props();

	const categoryLabels: Record<string, string> = {
		exterior: '外観',
		room: '客室',
		bath: '温泉',
		meal: 'お食事',
		view: '景色'
	};
	const categories = $derived(['all', ...new Set(photos.map((p) => p.category))]);
	let active = $state('all');
	let shown = $derived(active === 'all' ? photos : photos.filter((p) => p.category === active));
</script>

<div>
	<div class="mb-3 flex flex-wrap gap-2">
		{#each categories as c}
			<button
				type="button"
				onclick={() => (active = c)}
				class="rounded-full px-3 py-1 text-sm transition {active === c
					? 'bg-brand-800 text-white'
					: 'bg-stone-100 text-stone-600 hover:bg-stone-200'}"
			>
				{c === 'all' ? 'すべて' : categoryLabels[c] ?? c}
			</button>
		{/each}
	</div>
	<div class="grid grid-cols-2 gap-2 md:grid-cols-3">
		{#each shown as photo}
			<figure class="group relative overflow-hidden rounded-lg">
				<img src={photo.url} alt={photo.caption} class="h-44 w-full object-cover transition group-hover:scale-105" loading="lazy" />
				<figcaption class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-1.5 pt-6 text-xs text-white">
					{photo.caption}
				</figcaption>
			</figure>
		{/each}
	</div>
</div>
