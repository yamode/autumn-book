<script lang="ts">
	import { addDays, todayStr } from '$lib/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';
	import { StayDaysLoader, type StayDays } from '$lib/stay-days.svelte';
	// 検索バー・取引先ページ（B面）と同じ共通の日付パネル。PC は横に 2 か月、スマホは月を縦に並べる（2026-11-18 指示「B面と共通に」）。
	// チェックイン日を押して泊数を −/+ で選び、「この日程で検索」で反映する
	import StaySearchPanel, { type StayDayView } from '$lib/components/stay-search/StaySearchPanel.svelte';
	import { STAY_SEARCH_LABELS } from '$lib/stay-search/labels';
	import { normalizeLang } from '$lib/stay-search/params';

	let {
		open = $bindable(false),
		checkin = '',
		nights = 1,
		minDate = todayStr(),
		maxDate = addDays(minDate, 365),
		days = [],
		availableThrough = '',
		closed = [],
		daysNights = nights,
		daysAdults,
		source,
		guests,
		onSelect
	}: {
		open?: boolean;
		checkin?: string;
		nights?: number;
		minDate?: string;
		maxDate?: string;
		days?: { date: string; price: number | null }[];
		availableThrough?: string;
		/** 休館日（days と同じ条件のもの） */
		closed?: string[];
		/** days が何泊で計算されたものか（既定は nights） */
		daysNights?: number;
		/** days が何名で計算されたものか（既定は source.adults） */
		daysAdults?: number;
		/** 指定すると、泊数を変えたときに /api/stay-calendar からその泊数で予約できる日を取り直す */
		source?: { facilityId: string; planId?: string; adults: number; months?: number; preview?: boolean };
		/** 指定すると、カレンダーの上で人数（と室数）も選べる。人数を変えるとその人数の料金で日付を取り直す（プラン詳細・2026-11-02） */
		guests?: { adults: number; maxAdults: number; rooms?: number; maxRooms?: number };
		onSelect: (date: string, nights: number, adults?: number, rooms?: number) => void;
	} = $props();

	// 泊数・人数を変えたら、その条件で予約できる日を取り直す（ページのデータや取得元が変わったら捨てる）
	const loader = new StayDaysLoader();
	let sourceKey = $derived(source ? `${source.facilityId}|${source.planId ?? ''}|${source.months ?? ''}` : '');
	$effect(() => {
		void sourceKey;
		void days;
		loader.reset();
	});

	// svelte-ignore state_referenced_locally
	let selectedNights = $state(nights);
	// svelte-ignore state_referenced_locally
	let selectedAdults = $state(guests?.adults ?? source?.adults ?? 2);
	// svelte-ignore state_referenced_locally
	let selectedRooms = $state(guests?.rooms ?? 1);
	$effect(() => {
		if (open) {
			selectedNights = nights;
			selectedAdults = guests?.adults ?? source?.adults ?? 2;
			selectedRooms = guests?.rooms ?? 1;
		}
	});
	// カレンダーの料金を計算する人数（人数の欄があれば選んでいる人数）
	let adultsForDays = $derived(guests ? selectedAdults : (source?.adults ?? 0));
	$effect(() => {
		if (!open) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => { document.body.style.overflow = previous; };
	});

	// 表示中の泊数に対応する空き日（ページの days か、取り直した結果）。無ければ空（料金を出さず、選べる日も絞らない）
	const isPageDays = $derived(selectedNights === daysNights && (!source || adultsForDays === (daysAdults ?? source.adults)));
	const current = $derived<StayDays | null>(
		isPageDays ? { days, through: availableThrough, closed } : source ? loader.get(selectedNights, adultsForDays) : null
	);
	const priceByDate = $derived(new Map((current?.days ?? []).map((day) => [day.date, day.price])));
	const closedDates = $derived(new Set(current?.closed ?? []));
	$effect(() => {
		if (open && source && !isPageDays) loader.load(source, selectedNights, adultsForDays);
	});

	const panelLang = normalizeLang(getLocale()) || 'ja';
	const panelLabels = STAY_SEARCH_LABELS[panelLang];
	// パネルの中で選んでいる日（押したら onSelect するので、開くたびに今の日付から）
	// svelte-ignore state_referenced_locally
	let panelDate = $state(checkin);
	$effect(() => {
		if (open) panelDate = checkin;
	});
	const roomsByDate = $derived(new Map((current?.days ?? []).map((d) => [d.date, d.rooms ?? null])));
	function panelDay(iso: string): StayDayView {
		const price = priceByDate.get(iso);
		const knownUnavailable = Boolean(current?.through && iso <= current.through && (price == null || price <= 0));
		const disabled = iso < minDate || iso > maxDate || knownUnavailable;
		const has = price != null && price > 0;
		return {
			price: has ? price : null,
			rooms: has ? (roomsByDate.get(iso) ?? null) : null,
			disabled,
			mark: has ? '' : knownUnavailable && closedDates.has(iso) ? 'closed' : knownUnavailable ? 'dash' : ''
		};
	}

	function choose(date: string, length = selectedNights) {
		if (guests) onSelect(date, length, selectedAdults, guests.maxRooms ? selectedRooms : undefined);
		else onSelect(date, length);
		open = false;
	}
</script>

<svelte:window onkeydown={(event) => { if (open && event.key === 'Escape') open = false; }} />

{#snippet guestControls()}
	<!-- 人数・室数（人数で 1 泊の料金が変わるので、日付と同じ画面で選ぶ）。日付はそのままでも「この日程で検索」で条件だけ変えられる -->
	<div class="flex flex-wrap items-center gap-x-6 gap-y-2">
		{#if guests}
			<div class="flex items-center gap-3">
				<span class="text-sm text-stone-600">{m.searchbar_adults()}</span>
				<button type="button" disabled={selectedAdults <= 1} class="flex h-9 w-9 items-center justify-center rounded bg-stone-100 text-xl text-brand-800 disabled:text-stone-300" aria-label="−" onclick={() => selectedAdults--}>−</button>
				<span class="min-w-14 text-center text-sm font-medium tabular-nums">{m.searchbar_adults_option({ n: String(selectedAdults) })}</span>
				<button type="button" disabled={selectedAdults >= guests.maxAdults} class="flex h-9 w-9 items-center justify-center rounded bg-brand-800 text-xl text-white disabled:bg-stone-200" aria-label="+" onclick={() => selectedAdults++}>+</button>
			</div>
			{#if guests.maxRooms && guests.maxRooms > 1}
				<div class="flex items-center gap-3">
					<span class="text-sm text-stone-600">{m.searchbar_rooms()}</span>
					<button type="button" disabled={selectedRooms <= 1} class="flex h-9 w-9 items-center justify-center rounded bg-stone-100 text-xl text-brand-800 disabled:text-stone-300" aria-label="−" onclick={() => selectedRooms--}>−</button>
					<span class="min-w-10 text-center text-sm font-medium tabular-nums">{m.searchbar_rooms_option({ n: String(selectedRooms) })}</span>
					<button type="button" disabled={selectedRooms >= guests.maxRooms} class="flex h-9 w-9 items-center justify-center rounded bg-brand-800 text-xl text-white disabled:bg-stone-200" aria-label="+" onclick={() => selectedRooms++}>+</button>
				</div>
				{#if selectedRooms > 1}<p class="w-full text-xs text-stone-500">{m.datepicker_per_room_note()}</p>{/if}
			{/if}
		{/if}
	</div>
{/snippet}

{#if open}
	<!-- 共通の日付パネル（B面と同じ）。PC は画面の中央、スマホは下から出す -->
	<div class="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6" role="presentation" style="--pt-accent: var(--color-brand-800); --pt-accent-soft: color-mix(in srgb, var(--color-accent-500) 18%, transparent)">
		<button type="button" class="absolute inset-0 bg-stone-950/55" aria-label={m.common_close()} onclick={() => (open = false)}></button>
		<div class="relative max-h-[92dvh] w-full max-w-5xl overflow-y-auto rounded-t-3xl sm:max-h-[calc(100vh-3rem)] sm:rounded-3xl">
			<StaySearchPanel
				bind:date={panelDate}
				bind:nights={selectedNights}
				guests={adultsForDays || 2}
				rooms={selectedRooms}
				maxNights={7}
				today={minDate}
				latestYm={maxDate.slice(0, 7)}
				loading={loader.loading && !current}
				failed={loader.failed}
				day={panelDay}
				lang={panelLang}
				labels={panelLabels}
				{maxDate}
				onApply={() => (panelDate ? choose(panelDate, selectedNights) : (open = false))}
				onClose={() => (open = false)}
				toolbar={guests ? guestControls : undefined}
			/>
		</div>
	</div>
{/if}
