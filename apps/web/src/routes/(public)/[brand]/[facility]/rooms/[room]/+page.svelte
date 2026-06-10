<script lang="ts">
	import PlanCard from '$lib/components/PlanCard.svelte';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let base = $derived(`/${data.facility.brandSlug}/${data.facility.slug}`);
</script>

<svelte:head>
	<title>{m.room_detail_title({ name: data.room.name, facility: data.facility.name })}</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-8">
	<nav class="mb-4 text-xs text-stone-400">
		<a href={base} class="hover:underline">{data.facility.name}</a> / {m.room_detail_breadcrumb()} / {data.room.name}
	</nav>

	<img src={data.room.photos[0]?.url} alt={data.room.name} class="h-80 w-full rounded-2xl object-cover" />

	<div class="mt-6 flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="font-display text-2xl text-brand-900">{data.room.name}</h1>
			<p class="mt-1 text-stone-600">{data.room.headline}</p>
			<p class="mt-2 text-sm text-stone-500">{m.room_detail_capacity({ n: String(data.room.capacity), size: String(data.room.sizeM2) })}</p>
		</div>
		<div class="flex flex-wrap gap-1.5">
			{#each data.room.amenities as a}
				<span class="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600">{a}</span>
			{/each}
		</div>
	</div>

	<p class="mt-4 text-sm leading-relaxed text-stone-700">{data.room.description}</p>

	<section class="mt-10">
		<h2 class="font-display mb-4 text-xl text-brand-900">{m.room_detail_plans()}</h2>
		<div class="space-y-4">
			{#each data.plans as plan}
				<PlanCard {plan} href="{base}/plans/{plan.slug}" />
			{:else}
				<p class="text-sm text-stone-500">{m.room_detail_no_plans()}</p>
			{/each}
		</div>
	</section>
</div>
