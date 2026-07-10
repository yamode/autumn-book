<script lang="ts">
	import MapPanel from '$lib/components/MapPanel.svelte';
	import { formatPrice } from '$lib/format';
	import { dbg } from '$lib/debug';
	import { gaEvent } from '$lib/analytics';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();

	// GA4 予約ファネル: 空室検索（設計書 §9・条件変更ごとに送信）
	$effect(() => {
		if (!data.params.checkin) return;
		gaEvent('search', {
			search_term: `${data.params.checkin}/${data.params.nights}n/${data.params.adults}a`
		});
	});

	let highlighted = $state<string | null>(null);

	let mapItems = $derived(
		data.results.map((r) => ({
			id: r.facility.id,
			lat: r.facility.lat,
			lng: r.facility.lng,
			name: r.facility.name,
			label: r.minTotal !== null ? `${formatPrice(r.reference ? r.minPerPerson! : r.minTotal)}〜` : m.common_sold_out(),
			soldOut: r.minTotal === null
		}))
	);

	function plansHref(r: (typeof data.results)[0]) {
		const q = data.params.checkin
			? `?checkin=${data.params.checkin}&nights=${data.params.nights}&adults=${data.params.adults}`
			: '';
		return `/${r.facility.brandSlug}/${r.facility.slug}/plans${q}`;
	}

	function onPin(id: string) {
		highlighted = id;
		dbg('map pin click', id);
		document.getElementById(`fc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}
</script>

<svelte:head>
	<title>{m.search_title()}</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-6">
	<h1 class="font-display mb-1 text-xl text-brand-900">{m.search_heading()}</h1>
	{#if !data.params.checkin}
		<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
			{m.search_no_date()}<strong>{m.search_reference_note()}</strong>{m.search_reference_suffix()}
		</p>
	{:else}
		<p class="mb-4 text-sm text-stone-500">
			{m.search_date_info({ checkin: data.params.checkin, nights: String(data.params.nights), adults: String(data.params.adults) })}
		</p>
	{/if}

	<div class="grid gap-4 lg:grid-cols-[1fr_360px]">
		<MapPanel items={mapItems} height="520px" {highlighted} onpinclick={onPin} />

		<div class="flex gap-3 overflow-x-auto lg:max-h-[520px] lg:flex-col lg:overflow-y-auto">
			{#each data.results as r}
				<div
					id="fc-{r.facility.id}"
					role="presentation"
					class="w-72 shrink-0 rounded-xl border bg-white shadow-sm transition lg:w-auto {highlighted === r.facility.id
						? 'border-accent-500 ring-1 ring-accent-500'
						: 'border-stone-200'}"
					onmouseenter={() => (highlighted = r.facility.id)}
					onmouseleave={() => (highlighted = null)}
				>
					<img src={r.facility.photos[0].url} alt={r.facility.name} class="h-32 w-full rounded-t-xl object-cover" />
					<div class="p-3">
						<p class="text-xs text-stone-400">{r.facility.prefecture}</p>
						<h2 class="font-display text-lg text-brand-900">{r.facility.name}</h2>
						{#if r.minTotal !== null}
							<p class="mt-1 font-bold text-brand-900">
								{formatPrice(r.reference ? r.minPerPerson! : r.minTotal)}〜
								<span class="text-xs font-normal text-stone-500">
									{r.reference
										? m.search_price_per_person_ref()
										: m.search_price_total({ adults: String(data.params.adults), nights: String(data.params.nights) })}
								</span>
							</p>
							{#if !r.reference && r.remaining <= 2}
								<p class="mt-0.5 text-xs font-medium text-red-600">{m.search_remaining({ n: String(r.remaining) })}</p>
							{/if}
							<a href={plansHref(r)} class="mt-2 block rounded-md bg-brand-800 py-1.5 text-center text-sm text-white hover:bg-brand-700">{m.search_plan_link()}</a>
						{:else}
							<p class="mt-1 text-sm font-medium text-stone-400">{m.search_sold_out_msg()}</p>
							<p class="mt-1 text-xs text-stone-500">{m.search_sold_out_phone({ phone: r.facility.phone })}</p>
							<a href="/{r.facility.brandSlug}/{r.facility.slug}" class="mt-2 block rounded-md border border-stone-300 py-1.5 text-center text-sm text-stone-600 hover:bg-stone-50">{m.search_facility_link()}</a>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
