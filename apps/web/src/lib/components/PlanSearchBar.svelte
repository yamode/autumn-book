<script lang="ts">
	// 客室・プラン一覧の一番上の検索バー（日付〜泊数／人数／検索）。
	// 日付を押すと PC は直下に2か月のパネル、スマホは下からのシートを開く。どちらも泊数を変えると空き日をその場で取り直す。
	import { goto } from '$app/navigation';
	import ScrollDatePicker from '$lib/components/ScrollDatePicker.svelte';
	import StayDatePanel from '$lib/components/StayDatePanel.svelte';
	import { formatDate } from '$lib/format';
	import * as m from '$lib/paraglide/messages';
	import type { StayDay } from '$lib/stay-days.svelte';

	let {
		base,
		params,
		today,
		days,
		through,
		facilityId,
		panelOpen = $bindable(false)
	}: {
		base: string;
		params: { checkin: string; nights: number; adults: number; tag: string };
		today: string;
		days: StayDay[];
		through: string;
		facilityId: string;
		/** 外（部屋カードの「空室カレンダー」など）から開けるように bindable */
		panelOpen?: boolean;
	} = $props();

	// 確定前の下書き（「この日程で検索」「検索」で URL に反映する）
	// svelte-ignore state_referenced_locally
	let checkin = $state(params.checkin);
	// svelte-ignore state_referenced_locally
	let nights = $state(params.nights);
	// svelte-ignore state_referenced_locally
	let adults = $state(params.adults);
	$effect(() => {
		checkin = params.checkin;
		nights = params.nights;
		adults = params.adults;
	});
	let sheetOpen = $state(false);
	let isDesktop = $state(false);
	let root = $state<HTMLDivElement | null>(null);
	$effect(() => {
		const query = window.matchMedia('(min-width: 768px)');
		isDesktop = query.matches;
		const update = () => (isDesktop = query.matches);
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	});
	// 外から panelOpen にされたとき、スマホではシートで開く
	$effect(() => {
		if (panelOpen && !isDesktop) {
			panelOpen = false;
			sheetOpen = true;
		}
	});
	// パネルの外を押したら閉じる
	$effect(() => {
		if (!panelOpen) return;
		const onPointer = (event: PointerEvent) => {
			if (root && !root.contains(event.target as Node)) panelOpen = false;
		};
		document.addEventListener('pointerdown', onPointer);
		return () => document.removeEventListener('pointerdown', onPointer);
	});

	function openDates() {
		if (isDesktop) panelOpen = !panelOpen;
		else sheetOpen = true;
	}

	function search() {
		const query = new URLSearchParams({ nights: String(nights), adults: String(adults) });
		if (checkin) query.set('checkin', checkin);
		if (params.tag) query.set('tag', params.tag);
		panelOpen = false;
		void goto(`${base}/plans?${query}`, { noScroll: true, keepFocus: true });
	}
</script>

<div bind:this={root} class="relative">
	<div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-xl bg-brand-900 p-2.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] sm:gap-3 sm:p-3 {panelOpen ? 'rounded-b-none' : ''}">
		<button type="button" onclick={openDates} aria-expanded={panelOpen || sheetOpen} class="col-span-2 flex min-h-12 items-center gap-2 rounded-lg bg-white px-4 text-left text-base text-stone-800 sm:col-span-1 {panelOpen ? 'ring-2 ring-sky-500' : ''}">
			<span aria-hidden="true">📅</span>
			{#if checkin}{m.searchbar_date_nights({ date: formatDate(checkin), n: String(nights) })}{:else}<span class="text-stone-500">{m.bath_select_date()}</span>{/if}
		</button>
		<label class="flex min-h-12 items-center gap-2 rounded-lg bg-white px-3 text-base text-stone-800">
			<span class="sr-only">{m.searchbar_adults()}</span>
			<span aria-hidden="true">👤</span>
			<select bind:value={adults} class="w-full bg-transparent py-2 outline-none">
				{#each [1, 2, 3, 4, 5, 6] as count}<option value={count}>{m.searchbar_adults_option({ n: String(count) })}</option>{/each}
			</select>
		</label>
		<button type="button" onclick={search} class="min-h-12 rounded-lg bg-sky-600 px-6 text-base font-semibold text-white hover:bg-sky-700">{m.datepanel_search()}</button>
	</div>
	{#if panelOpen && isDesktop}
		<div class="absolute inset-x-0 top-full z-40">
			<StayDatePanel
				bind:checkin
				bind:nights
				{adults}
				{today}
				{days}
				{through}
				daysNights={params.nights}
				daysAdults={params.adults}
				source={{ facilityId }}
				onApply={search}
				onClose={() => (panelOpen = false)}
			/>
		</div>
	{/if}
</div>
<ScrollDatePicker
	bind:open={sheetOpen}
	{checkin}
	{nights}
	minDate={today}
	{days}
	availableThrough={through}
	daysNights={params.nights}
	daysAdults={params.adults}
	source={{ facilityId, adults }}
	onSelect={(date, selectedNights) => {
		checkin = date;
		nights = selectedNights;
		search();
	}}
/>
