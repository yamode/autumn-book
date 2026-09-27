<script lang="ts">
	import type { Photo } from '$lib/types';
	import * as m from '$lib/paraglide/messages';

	let { photos, cover, name }: { photos: Photo[]; cover: string; name: string } = $props();
	let activeIndex = $state(0);
	let images = $derived([
		{ url: cover, caption: name, category: 'exterior' as const },
		...photos.filter((photo) => photo.url !== cover)
	]);
	let active = $derived(images[activeIndex] ?? images[0]);

	function showPhoto(offset: number) {
		activeIndex = (activeIndex + offset + images.length) % images.length;
	}
</script>

<div class="space-y-2">
	<div class="relative overflow-hidden rounded-xl bg-stone-100">
		<img src={active.url} alt={active.caption || name} class="aspect-[16/9] w-full object-cover" />
		{#if active.caption}
			<p class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-9 text-xs text-white">{active.caption}</p>
		{/if}
		{#if images.length > 1}
			<button type="button" aria-label={m.facility_gallery_prev()} onclick={() => showPhoto(-1)} class="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 px-3 py-1.5 text-lg text-white hover:bg-black/60 sm:hidden">‹</button>
			<button type="button" aria-label={m.facility_gallery_next()} onclick={() => showPhoto(1)} class="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 px-3 py-1.5 text-lg text-white hover:bg-black/60 sm:hidden">›</button>
			<span class="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white sm:hidden">{activeIndex + 1} / {images.length}</span>
		{/if}
	</div>
	{#if images.length > 1}
		<div class="hidden gap-2 overflow-x-auto pb-1 sm:flex" aria-label={m.facility_gallery()}>
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
