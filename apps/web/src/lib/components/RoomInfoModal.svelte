<script lang="ts">
	// 客室の紹介をその場で見せるモーダル（プラン詳細の客室選択から開く。予約の流れを離れずに確認できる）
	import ContentBlocks from '$lib/components/ContentBlocks.svelte';
	import type { RoomType } from '$lib/types';
	import * as m from '$lib/paraglide/messages';

	let { room = $bindable(null), pageHref }: { room: RoomType | null; pageHref: (room: RoomType) => string } = $props();
	let photoIndex = $state(0);
	let dialog = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!room) return;
		photoIndex = 0;
		dialog?.focus();
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => { document.body.style.overflow = previous; };
	});

	function close() {
		room = null;
	}
</script>

<svelte:window onkeydown={(event) => { if (room && event.key === 'Escape') close(); }} />

{#if room}
	{@const photo = room.photos[photoIndex]}
	<div class="fixed inset-0 z-[100] flex items-end justify-center sm:items-center" role="presentation">
		<button type="button" class="absolute inset-0 bg-stone-950/55" aria-label={m.common_close()} onclick={close}></button>
		<div bind:this={dialog} data-room-info tabindex="-1" role="dialog" aria-modal="true" aria-label={room.name} class="relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:w-[min(92vw,760px)] sm:rounded-2xl">
			<div class="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 sm:px-6">
				<h2 class="font-display min-w-0 truncate text-lg text-brand-900">{room.name}</h2>
				<button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-stone-600 hover:bg-stone-100" aria-label={m.common_close()} onclick={close}>×</button>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-6">
				{#if photo}
					<figure class="mt-4">
						<img src={photo.url} alt={photo.caption || room.name} class="aspect-[16/10] w-full rounded-xl object-cover" />
						{#if photo.caption}<figcaption class="mt-1 text-xs text-stone-500">{photo.caption}</figcaption>{/if}
					</figure>
					{#if room.photos.length > 1}
						<div class="mt-2 flex gap-2 overflow-x-auto pb-1">
							{#each room.photos as item, index (item.url + index)}
								<button type="button" onclick={() => (photoIndex = index)} aria-label={`${m.room_detail_photos()} ${index + 1}`} aria-pressed={index === photoIndex} class="shrink-0 overflow-hidden rounded-md ring-offset-1 {index === photoIndex ? 'ring-2 ring-brand-800' : 'opacity-70 hover:opacity-100'}">
									<img src={item.url} alt="" class="h-14 w-20 object-cover" loading="lazy" />
								</button>
							{/each}
						</div>
					{/if}
				{/if}
				{#if room.headline}<p class="mt-4 text-stone-700">{room.headline}</p>{/if}
				<p class="mt-2 text-sm text-stone-500">{m.room_detail_capacity({ n: String(room.capacity), size: String(room.sizeM2) })}</p>
				{#if room.amenities.length}
					<div class="mt-3 flex flex-wrap gap-1.5">
						{#each room.amenities as amenity}<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600">{amenity}</span>{/each}
					</div>
				{/if}
				{#if room.description}<p class="mt-4 whitespace-pre-line text-sm leading-relaxed text-stone-700">{room.description}</p>{/if}
				<ContentBlocks specs={room.specs} sections={room.sections} specsTitle={m.room_detail_specs()} />
			</div>
			<div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-4 py-3 sm:px-6">
				<a href={pageHref(room)} target="_blank" rel="noopener" class="text-sm text-brand-700 underline underline-offset-4 hover:text-brand-900">{m.room_info_open_page()} ↗</a>
				<button type="button" onclick={close} class="rounded-lg bg-brand-800 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">{m.room_info_back()}</button>
			</div>
		</div>
	</div>
{/if}
