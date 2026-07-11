<script lang="ts">
	import SearchBar from '$lib/components/SearchBar.svelte';
	import MapPanel from '$lib/components/MapPanel.svelte';
	import { formatPrice } from '$lib/format';
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();

	let mapItems = $derived(
		data.results.map((r) => ({
			id: r.facility.id,
			lat: r.facility.lat,
			lng: r.facility.lng,
			name: r.facility.name,
			label: r.minPerPerson ? `${formatPrice(r.minPerPerson)}〜` : m.common_sold_out(),
			soldOut: !r.minPerPerson,
			href: `/${r.facility.brandSlug}/${r.facility.slug}/plans`
		}))
	);
</script>

<svelte:head>
	<title>{m.home_title()}</title>
	<meta name="description" content={m.home_description()} />
</svelte:head>

<!-- ヒーロー -->
<section class="relative">
	<img src="https://picsum.photos/seed/yamado-hero/1600/700" alt="" class="h-[420px] w-full object-cover sm:h-[480px]" />
	<div class="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-black/10"></div>
	<div class="absolute inset-x-0 bottom-0 mx-auto max-w-6xl px-4 pb-8">
		<h1 class="font-display text-3xl text-white drop-shadow sm:text-4xl">{m.home_hero_headline()}</h1>
		<p class="mt-2 text-sm text-white/90 drop-shadow">{m.home_hero_sub()}</p>
		<div class="mt-4 max-w-2xl">
			<SearchBar large />
		</div>
	</div>
</section>

<!-- 地図プレビュー + 施設カード -->
<section class="mx-auto max-w-6xl px-4 py-12">
	<h2 class="font-display mb-1 text-2xl text-brand-900">{m.home_map_heading()}</h2>
	<p class="mb-4 text-sm text-stone-500">{m.home_map_sub()}</p>
	<MapPanel items={mapItems} height="380px" onpinclick={(id) => {
		const r = data.results.find((x) => x.facility.id === id);
		if (r) goto(`/${r.facility.brandSlug}/${r.facility.slug}/plans`);
	}} />
</section>

<section class="mx-auto max-w-6xl px-4">
	<h2 class="font-display mb-4 text-2xl text-brand-900">{m.home_list_heading()}</h2>
	<div class="grid gap-6 sm:grid-cols-2">
		{#each data.results as r}
			<div class="group overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:shadow-lg">
				<a href="/{r.facility.brandSlug}/{r.facility.slug}/plans" class="block">
					<div class="relative">
						<img src={r.facility.photos[0].url} alt={r.facility.name} class="h-56 w-full object-cover transition group-hover:scale-[1.02]" />
						<span class="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">{r.facility.prefecture}</span>
					</div>
					<div class="px-5 pt-5">
						<h3 class="font-display text-xl text-brand-900">{r.facility.name}</h3>
						<p class="mt-1 text-sm text-stone-600">{r.facility.catchCopy}</p>
						<p class="mt-3 text-lg font-bold text-brand-900">
							{#if r.minPerPerson}
								{formatPrice(r.minPerPerson)}<span class="text-xs font-normal text-stone-500">{m.home_price_from()}</span>
							{:else}
								<span class="text-stone-400">{m.common_sold_out()}</span>
							{/if}
						</p>
					</div>
				</a>
				<div class="flex flex-wrap items-center justify-between gap-3 px-5 pb-5 pt-4">
					<a href="/{r.facility.brandSlug}/{r.facility.slug}/plans" class="inline-flex items-center rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">{m.home_list_view_plans()}</a>
					{#if r.facility.websiteUrl}
						<a href={r.facility.websiteUrl} target="_blank" rel="noopener noreferrer" class="text-sm text-accent-600 hover:underline">{m.home_list_official_site()} ↗</a>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</section>

<!-- 会員制度 -->
<section class="mx-auto mt-14 max-w-6xl px-4">
	<div class="rounded-2xl bg-brand-800 px-6 py-8 text-white sm:flex sm:items-center sm:justify-between">
		<div>
			<h2 class="font-display text-xl">{m.home_member_heading()}</h2>
			<p class="mt-2 text-sm text-stone-300">
				{m.home_member_sub()}
			</p>
		</div>
		<a href="/auth/register" class="mt-4 inline-block rounded-lg bg-accent-600 px-6 py-2.5 text-sm font-medium hover:bg-accent-500 sm:mt-0">{m.home_member_cta()}</a>
	</div>
</section>
