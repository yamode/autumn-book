<script lang="ts">
	import SearchBar from '$lib/components/SearchBar.svelte';
	import MapPanel from '$lib/components/MapPanel.svelte';
	import { formatPrice } from '$lib/format';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { areaLabel } from '$lib/components/guests';
	import { facilityThumbnailUrl } from '$lib/facility-thumbnail';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();

	// 宿一覧（写真カード）を主、地図は従（開閉式）。デスクトップのみ初期表示で開き、モバイルは閉じる。
	// 閉じている間は MapPanel を描画しない（モバイルで maplibre・タイルを読まない）
	let mapOpen = $state(false);
	onMount(() => {
		if (window.matchMedia('(min-width: 1024px)').matches) mapOpen = true;
	});

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

<!-- 写真を置かない導入。検索から宿を選べる、余白のあるポータル。 -->
<div class="bg-white text-stone-900">
	<section class="mx-auto max-w-6xl px-4 pb-14 pt-10 sm:pb-20 sm:pt-16">
		<div class="border-b border-stone-200 pb-10 sm:pb-14">
			<p class="mb-5 text-[11px] font-semibold tracking-[0.3em] text-stone-500">YAMADO STAYS</p>
			<div class="max-w-4xl">
				<h1 class="font-display text-4xl leading-[1.35] tracking-[0.06em] text-brand-900 sm:text-5xl">{m.home_hero_headline()}</h1>
				<p class="mt-5 max-w-2xl text-sm leading-8 text-stone-600 sm:text-base">{m.home_hero_sub()}</p>
			</div>
		</div>
		<div class="pt-8 sm:pt-10">
			<p class="mb-4 text-sm font-semibold tracking-wider text-brand-900">{m.searchbar_submit()}</p>
			<SearchBar large />
		</div>
	</section>

<!-- 宿一覧。写真と施設名を主役にし、予約への導線を残す。 -->
<section class="mx-auto max-w-6xl px-4 pb-8 sm:pb-16">
	<div class="mb-8 flex items-end justify-between gap-4 border-b border-stone-200 pb-5 sm:mb-10">
		<div>
			<p class="mb-2 text-[11px] font-semibold tracking-[0.3em] text-stone-500">OUR STAYS</p>
			<h2 class="font-display text-2xl text-brand-900 sm:text-3xl">{m.home_list_heading()}</h2>
		</div>
		<span class="pb-1 text-sm tabular-nums text-stone-400">{String(data.results.length).padStart(2, '0')}</span>
	</div>
	<div class="grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:gap-x-12">
		{#each data.results as r, i (r.facility.id)}
			<article class="group min-w-0">
				<a href="/{r.facility.brandSlug}/{r.facility.slug}/plans" class="block focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-800">
					<div class="relative overflow-hidden">
						<!-- 16:9 固定（width/height＋aspect-video で CLS 防止） -->
						<img
							src={facilityThumbnailUrl(r.facility.slug, r.facility.photos[0]?.url ?? '')}
							alt={r.facility.name}
							width="800"
							height="450"
							loading={i < 2 ? 'eager' : 'lazy'}
							decoding="async"
							class="aspect-video h-auto w-full bg-stone-100 object-cover transition duration-700 group-hover:scale-[1.035]"
						/>
					</div>
					<div class="pt-5">
						<p class="text-xs font-semibold tracking-[0.16em] text-stone-500">{areaLabel(r.facility)}</p>
						<h3 class="font-display mt-2 text-2xl leading-snug text-brand-900 sm:text-[28px]">{r.facility.name}</h3>
						<p class="mt-2 min-h-12 text-sm leading-6 text-stone-600">{r.facility.catchCopy}</p>
						<p class="mt-4 text-base font-semibold text-brand-900">
							{#if r.minPerPerson}
								{formatPrice(r.minPerPerson)}<span class="ml-1 text-xs font-normal text-stone-500">{m.home_price_from()}</span>
							{:else}
								<span class="text-stone-500">{m.common_sold_out()}</span>
							{/if}
						</p>
					</div>
				</a>
				<div class="mt-5 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-stone-200 pt-4 text-sm">
					<a href="/{r.facility.brandSlug}/{r.facility.slug}/plans" class="font-semibold text-brand-900 underline decoration-stone-300 underline-offset-8 hover:decoration-brand-900">{m.home_list_view_plans()} <span aria-hidden="true">↗</span></a>
					{#if r.facility.websiteUrl}
						<a href={r.facility.websiteUrl} target="_blank" rel="noopener noreferrer" class="text-stone-600 hover:text-brand-900 hover:underline">{m.home_list_official_site()} ↗</a>
					{/if}
				</div>
			</article>
		{/each}
	</div>
</section>

<!-- 地図（従・開閉式） -->
<section class="mx-auto max-w-6xl px-4 pt-10">
	<button
		type="button"
		class="flex w-full items-center justify-between gap-3 border-y border-stone-200 py-5 text-left hover:text-brand-700"
		aria-expanded={mapOpen}
		aria-controls="home-map"
		onclick={() => (mapOpen = !mapOpen)}
	>
		<span>
			<span class="font-display block text-lg text-brand-900">{m.home_map_heading()}</span>
			<span class="block text-xs text-stone-500">{m.home_map_sub()}</span>
		</span>
		<span aria-hidden="true" class="shrink-0 text-stone-400 transition {mapOpen ? 'rotate-180' : ''}">▾</span>
	</button>
	<div id="home-map">
		{#if mapOpen}
			<div class="mt-3">
				<MapPanel items={mapItems} height="340px" onpinclick={(id) => {
					const r = data.results.find((x) => x.facility.id === id);
					if (r) goto(`/${r.facility.brandSlug}/${r.facility.slug}/plans`);
				}} />
			</div>
		{/if}
	</div>
</section>

<!-- 会員制度 -->
<section class="mx-auto mt-16 max-w-6xl px-4">
	<div class="border border-stone-200 bg-brand-50 px-6 py-10 sm:flex sm:items-center sm:justify-between sm:px-10">
		<div>
			<p class="mb-2 text-[11px] font-semibold tracking-[0.3em] text-stone-500">MEMBERSHIP</p>
			<h2 class="font-display text-xl text-brand-900 sm:text-2xl">{m.home_member_heading()}</h2>
			<p class="mt-3 max-w-2xl text-sm leading-7 text-stone-600">
				{m.home_member_sub()}
			</p>
		</div>
		<a href="/auth/register" class="mt-6 inline-block shrink-0 border border-brand-900 px-6 py-3 text-center text-sm font-semibold text-brand-900 transition hover:bg-brand-900 hover:text-white sm:ml-8 sm:mt-0">{m.home_member_cta()} <span aria-hidden="true">↗</span></a>
	</div>
</section>
</div>
