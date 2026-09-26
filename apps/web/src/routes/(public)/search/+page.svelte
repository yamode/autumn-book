<script lang="ts">
	import { onMount, tick } from 'svelte';
	import MapPanel from '$lib/components/MapPanel.svelte';
	import { formatPrice } from '$lib/format';
	import { dbg } from '$lib/debug';
	import { gaEvent } from '$lib/analytics';
	import { facilitySiteUrl } from '$lib/facility-site';
	import { areaLabel, guestsLabel, searchQuery } from '$lib/components/guests';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();

	// GA4 予約ファネル: 空室検索（設計書 §9・条件変更ごとに送信）
	$effect(() => {
		if (!data.params.checkin) return;
		gaEvent('search', {
			search_term: `${data.params.checkin}/${data.params.nights}n/${data.params.adults}a/${data.params.children}c`
		});
	});

	let highlighted = $state<string | null>(null);

	// 施設数が少ない（現状2施設）ので写真つきカードを主役にし、地図は従（開閉式）にする（一休の一覧に準拠）。
	// 地図はデスクトップ（lg 以上）だけ初期表示で開き、モバイルは閉じておく。
	// 閉じている間は MapPanel を描画しない（maplibre の読み込み・タイル取得をモバイルで発生させない）。
	let mapOpen = $state(false);
	onMount(() => {
		if (window.matchMedia('(min-width: 1024px)').matches) mapOpen = true;
	});

	async function showMap() {
		mapOpen = true;
		await tick();
		document.getElementById('search-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	// 料金表示は全画面で「1名1泊・税込」を主に統一する（1名 = 大人1名。子ども分は合計にだけ含める）。
	// minPerPerson は「大人1名あたりの全泊合計」なので泊数で割って 1名1泊 に換算する（参考料金は元から1名1泊）。
	function perPersonNight(r: (typeof data.results)[0]): number {
		if (r.reference) return r.minPerPerson!;
		return Math.round(r.minPerPerson! / Math.max(1, data.params.nights));
	}

	let guests = $derived(guestsLabel(data.params.adults, data.params.children));
	// 子ども連れの検索で、実データ（supabase）は子供料金未対応 → 大人のみの料金である旨を出す
	let childrenUnsupported = $derived(data.params.children > 0 && !data.childrenSupported);

	let mapItems = $derived(
		data.results.map((r) => ({
			id: r.facility.id,
			lat: r.facility.lat,
			lng: r.facility.lng,
			name: r.facility.name,
			label: r.minTotal !== null ? `${formatPrice(perPersonNight(r))}〜` : m.common_sold_out(),
			soldOut: r.minTotal === null
		}))
	);

	function plansHref(r: (typeof data.results)[0]) {
		const q = data.params.checkin ? `?${searchQuery(data.params)}` : '';
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
	<div class="mb-1 flex items-center justify-between gap-3">
		<h1 class="font-display text-xl text-brand-900">{m.search_heading()}</h1>
		<!-- モバイル: 件数の横に「地図で見る」（地図は一覧の下で開く） -->
		<button
			type="button"
			class="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 lg:hidden"
			aria-controls="search-map"
			aria-expanded={mapOpen}
			onclick={() => (mapOpen ? (mapOpen = false) : showMap())}
		>
			<span aria-hidden="true">🗺</span>{mapOpen ? m.search_map_hide() : m.search_map_show()}
		</button>
	</div>
	{#if !data.params.checkin}
		<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
			{m.search_no_date()}<strong>{m.search_reference_note()}</strong>{m.search_reference_suffix()}
		</p>
	{:else}
		<p class="mb-4 text-sm text-stone-500">
			{m.search_date_info({ checkin: data.params.checkin, nights: String(data.params.nights), guests })}
			{#if data.params.children > 0 && data.childrenSupported}
				<span class="block text-xs">{m.children_price_note()}</span>
			{/if}
		</p>
	{/if}
	{#if childrenUnsupported}
		<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{m.children_unsupported_note()}</p>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
		<!-- 主: 写真つき施設カード -->
		<section aria-label={m.search_result_count({ n: String(data.results.length) })}>
			<p class="mb-3 text-xs text-stone-500">{m.search_result_count({ n: String(data.results.length) })}</p>
			<div class="space-y-5">
				{#each data.results as r, i (r.facility.id)}
					{@const soldOut = r.minTotal === null}
					<article
						id="fc-{r.facility.id}"
						class="scroll-mt-20 overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:shadow-md md:flex lg:scroll-mt-28 {highlighted ===
						r.facility.id
							? 'border-accent-500 ring-1 ring-accent-500'
							: 'border-stone-200'}"
						onmouseenter={() => (highlighted = r.facility.id)}
						onmouseleave={() => (highlighted = null)}
					>
						<!-- 写真 16:9（width/height と aspect-video で読み込み前から枠を確保＝CLS 防止）。1枚目のみ即時読み込み -->
						<a href={plansHref(r)} class="relative block md:w-[48%] md:shrink-0" tabindex="-1" aria-hidden="true">
							<img
								src={r.facility.photos[0]?.url}
								alt=""
								width="800"
								height="450"
								loading={i === 0 ? 'eager' : 'lazy'}
								fetchpriority={i === 0 ? 'high' : 'auto'}
								decoding="async"
								class="aspect-video h-auto w-full bg-stone-100 object-cover md:h-full"
							/>
							<!-- 空室バッジ -->
							{#if soldOut}
								<span class="absolute left-3 top-3 rounded-full bg-stone-600/90 px-2.5 py-1 text-xs font-medium text-white">{m.common_sold_out()}</span>
							{:else if r.reference}
								<span class="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white">{m.search_badge_reference()}</span>
							{:else if r.remaining <= 2}
								<span class="absolute left-3 top-3 rounded-full bg-red-600 px-2.5 py-1 text-xs font-medium text-white">{m.search_remaining({ n: String(r.remaining) })}</span>
							{:else}
								<span class="absolute left-3 top-3 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white">{m.search_badge_available()}</span>
							{/if}
						</a>

						<div class="flex flex-1 flex-col p-4 md:p-5">
							<p class="text-xs text-stone-500">{areaLabel(r.facility)}</p>
							<h2 class="font-display mt-0.5 text-xl leading-snug text-brand-900">
								<a href={plansHref(r)} class="hover:underline">{r.facility.name}</a>
							</h2>
							{#if r.facility.catchCopy}
								<p class="mt-1.5 line-clamp-2 text-sm text-stone-600">{r.facility.catchCopy}</p>
							{/if}

							<div class="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-stone-100 pt-3 md:mt-auto">
								{#if !soldOut}
									<div>
										<p class="text-xl font-bold text-brand-900">
											{formatPrice(perPersonNight(r))}〜<span class="text-xs font-normal text-stone-500">
												{r.reference
													? m.search_price_per_person_ref()
													: data.params.children > 0
														? m.price_unit_adult_night()
														: m.price_unit_pp_night()}
											</span>
										</p>
										{#if !r.reference}
											<!-- 従: 1室の合計（人数×泊数。子ども分を含む） -->
											<p class="text-xs text-stone-500">
												{m.search_price_total({ guests, nights: String(data.params.nights), total: formatPrice(r.minTotal!) })}
											</p>
										{/if}
									</div>
									<a href={plansHref(r)} class="inline-flex items-center rounded-lg bg-brand-800 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
										{m.search_plan_link()}
									</a>
								{:else}
									<div>
										<p class="text-sm font-medium text-stone-500">{m.search_sold_out_msg()}</p>
										<p class="mt-0.5 text-xs text-stone-500">{m.search_sold_out_phone({ phone: r.facility.phone })}</p>
									</div>
								{/if}
							</div>
							<a
								href={facilitySiteUrl(r.facility)}
								target="_blank"
								rel="noopener noreferrer"
								class="mt-2 self-start text-xs text-accent-600 hover:underline"
							>{m.search_facility_site_link()} ↗</a>
						</div>
					</article>
				{/each}
			</div>
		</section>

		<!-- 従: 地図（開閉式）。デスクトップは右に追従、モバイルは一覧の下 -->
		<aside id="search-map" class="scroll-mt-20 lg:sticky lg:top-28 lg:self-start">
			<button
				type="button"
				class="flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-medium text-brand-900 hover:bg-stone-50"
				aria-expanded={mapOpen}
				onclick={() => (mapOpen = !mapOpen)}
			>
				<span class="flex items-center gap-2"><span aria-hidden="true">🗺</span>{mapOpen ? m.search_map_hide() : m.search_map_show()}</span>
				<span aria-hidden="true" class="text-stone-400 transition {mapOpen ? 'rotate-180' : ''}">▾</span>
			</button>
			{#if mapOpen}
				<div class="mt-2">
					<MapPanel items={mapItems} height="380px" {highlighted} onpinclick={onPin} />
				</div>
			{/if}
		</aside>
	</div>
</div>
