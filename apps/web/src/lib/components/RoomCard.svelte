<script lang="ts">
	import type { RoomType } from '$lib/types';
	import * as m from '$lib/paraglide/messages';

	let { room, href }: { room: RoomType; href?: string } = $props();
</script>

<svelte:element this={href ? 'a' : 'div'} {href} class="flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm {href ? 'transition hover:shadow-md' : ''}">
	<img src={room.photos[0]?.url} alt={room.name} class="h-44 w-full object-cover" loading="lazy" />
	<div class="flex flex-col gap-1.5 p-4">
		<h3 class="font-display text-lg text-brand-900">{room.name}</h3>
		<p class="text-sm text-stone-600">{room.headline}</p>
		<p class="text-xs text-stone-500">{m.room_card_capacity({ n: String(room.capacity), size: String(room.sizeM2) })}</p>
		<div class="flex flex-wrap gap-1.5 pt-1">
			{#each room.amenities as a}
				<span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{a}</span>
			{/each}
		</div>
	</div>
</svelte:element>
