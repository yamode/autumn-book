<script lang="ts">
	import type { Photo } from '$lib/types';
	import * as m from '$lib/paraglide/messages';

	let { photos, fallback, name }: { photos: Photo[]; fallback: string; name: string } = $props();
	let activeIndex = $state(0);
	let images = $derived(photos.length ? photos : [{ url: fallback, caption: name, category: 'exterior' as const }]);
	let active = $derived(images[activeIndex] ?? images[0]);
</script>

<div class="space-y-2">
	<div class="relative overflow-hidden rounded-xl bg-stone-100">
		<img src={active.url} alt={active.caption || name} class="aspect-[16/9] w-full object-cover" />
		{#if active.caption}
			<p class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-4 pb-3 pt-9 text-xs text-white">{active.caption}</p>
		{/if}
	</div>
	{#if images.length > 1}
		<div class="flex gap-2 overflow-x-auto pb-1" aria-label={m.facility_gallery()}>
			{#each images as photo, index}
				<button
					type="button"
					class="shrink-0 overflow-hidden rounded-md border-2 {activeIndex === index ? 'border-brand-800' : 'border-transparent'}"
					aria-label={photo.caption || `${name}の写真 ${index + 1}`}
					aria-pressed={activeIndex === index}
					onclick={() => (activeIndex = index)}
				>
					<img src={photo.url} alt="" class="h-16 w-24 object-cover sm:h-20 sm:w-28" loading="lazy" />
				</button>
			{/each}
		</div>
	{/if}
</div>
