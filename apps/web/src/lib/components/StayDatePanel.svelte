<script lang="ts">
	// PC の検索バー直下に開く日付パネル（2か月横並び・‹ › で月送り）。
	// 日付を押しても閉じず、泊数を変えて見比べてから「この日程で検索」で確定する。
	import { shiftYearMonth } from '$lib/calendar-range';
	import { addDays, formatDate, formatPrice } from '$lib/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';
	import { StayDaysLoader, type StayDay, type StayDays, type StaySource } from '$lib/stay-days.svelte';

	let {
		checkin = $bindable(''),
		nights = $bindable(1),
		adults,
		today,
		days,
		through,
		closed = [],
		daysNights,
		daysAdults,
		source,
		onApply,
		onClose
	}: {
		checkin: string;
		nights: number;
		adults: number;
		today: string;
		/** ページが持っている空き日（daysNights 泊・daysAdults 名で計算済み） */
		days: StayDay[];
		through: string;
		/** 休館日 */
		closed?: string[];
		daysNights: number;
		daysAdults: number;
		source: StaySource;
		onApply: () => void;
		onClose: () => void;
	} = $props();

	const loader = new StayDaysLoader();
	$effect(() => {
		void days;
		void source.facilityId;
		loader.reset();
	});
	const isPageDays = $derived(nights === daysNights && adults === daysAdults);
	const current = $derived<StayDays | null>(isPageDays ? { days, through, closed } : loader.get(nights, adults));
	const priceByDate = $derived(new Map((current?.days ?? []).map((day) => [day.date, day.price])));
	const closedDates = $derived(new Set(current?.closed ?? []));
	$effect(() => {
		if (!isPageDays) loader.load(source, nights, adults);
	});

	const locale = getLocale() === 'zh-TW' ? 'zh-TW' : getLocale() === 'en' ? 'en-US' : 'ja-JP';
	const weekdays = Array.from({ length: 7 }, (_, index) =>
		new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 8, 1 + index)))
	);
	const firstMonth = $derived(today.slice(0, 7));
	const lastMonth = $derived(shiftYearMonth(firstMonth, 11));
	// svelte-ignore state_referenced_locally
	let leftMonth = $state((checkin || today).slice(0, 7));
	const shownMonths = $derived([leftMonth, shiftYearMonth(leftMonth, 1)].filter((month) => month <= lastMonth));

	function monthOf(key: string) {
		const [year, number] = key.split('-').map(Number);
		const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
		return {
			key,
			label: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, number - 1, 1))),
			offset: new Date(Date.UTC(year, number - 1, 1)).getUTCDay(),
			dates: Array.from({ length: count }, (_, index) => `${key}-${String(index + 1).padStart(2, '0')}`)
		};
	}
	const checkout = $derived(checkin ? addDays(checkin, nights) : '');
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') onClose(); }} />

<div role="dialog" aria-label={m.searchbar_checkin()} class="rounded-b-2xl border border-t-0 border-stone-300 bg-white px-5 pb-4 pt-3 shadow-lg">
	<div class="flex flex-wrap items-center gap-3 border-b border-stone-100 pb-3">
		<span class="text-sm text-stone-600">{m.searchbar_nights()}</span>
		<button type="button" disabled={nights <= 1} class="flex h-8 w-8 items-center justify-center rounded bg-stone-100 text-lg text-brand-800 disabled:text-stone-300" aria-label="−" onclick={() => nights--}>−</button>
		<span class="min-w-10 text-center text-sm font-medium tabular-nums">{m.searchbar_nights_option({ n: String(nights) })}</span>
		<button type="button" disabled={nights >= 7} class="flex h-8 w-8 items-center justify-center rounded bg-brand-800 text-lg text-white disabled:bg-stone-200" aria-label="+" onclick={() => nights++}>+</button>
		{#if loader.loading}
			<span class="text-xs text-stone-500" role="status">{m.datepicker_loading()}</span>
		{:else if loader.failed}
			<span class="text-xs text-red-600" role="status">{m.datepicker_load_failed()}</span>
		{:else}
			<span class="text-xs text-stone-400">{m.datepanel_hint()}</span>
		{/if}
		<span class="ml-auto text-xs text-stone-500">{m.datepanel_price_note()}</span>
		<button type="button" class="flex h-8 w-8 items-center justify-center rounded-full text-lg text-stone-500 hover:bg-stone-100" aria-label={m.common_close()} onclick={onClose}>×</button>
	</div>
	<div class="relative mt-3 grid grid-cols-2 gap-8">
		<button type="button" disabled={leftMonth <= firstMonth} onclick={() => (leftMonth = shiftYearMonth(leftMonth, -1))} class="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-30" aria-label={m.calendar_prev()}>‹</button>
		<button type="button" disabled={shiftYearMonth(leftMonth, 1) >= lastMonth} onclick={() => (leftMonth = shiftYearMonth(leftMonth, 1))} class="absolute right-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-30" aria-label={m.calendar_next()}>›</button>
		{#each shownMonths.map(monthOf) as month (month.key)}
			<section aria-label={month.label}>
				<h3 class="mb-2 text-center text-base font-semibold leading-8 text-stone-900">{month.label}</h3>
				<div class="grid grid-cols-7 text-center text-xs">
					{#each weekdays as weekday, index}<div class="pb-2 font-medium {index === 0 ? 'text-red-500' : index === 6 ? 'text-blue-500' : 'text-stone-500'}">{weekday}</div>{/each}
					{#each Array(month.offset) as _}<div aria-hidden="true"></div>{/each}
					{#each month.dates as date (date)}
						{@const price = priceByDate.get(date)}
						{@const knownUnavailable = Boolean(current?.through && date <= current.through && (price == null || price <= 0))}
						{@const disabled = date < today || knownUnavailable}
						{@const selected = date === checkin}
						{@const inStay = checkin && date > checkin && date <= checkout}
						<button
							type="button"
							{disabled}
							aria-label={`${formatDate(date)}${price != null && price > 0 ? ` ${formatPrice(price)}` : ''}`}
							aria-pressed={selected}
							onclick={() => (checkin = date)}
							class="flex min-h-14 min-w-0 flex-col items-center border-t border-stone-100 px-0.5 py-1.5 tabular-nums transition {selected ? 'rounded bg-sky-600 text-white' : inStay ? 'bg-sky-100 text-sky-900' : disabled ? 'text-stone-300' : 'text-stone-900 hover:bg-sky-50'}"
						>
							<span class="text-sm font-medium">{Number(date.slice(-2))}</span>
							{#if price != null && price > 0}
								<span class="mt-0.5 max-w-full text-[11px] leading-tight {selected ? 'text-white' : 'text-sky-700'}">{price.toLocaleString('ja-JP')}<span class="text-[10px]">〜</span></span>
							{:else if knownUnavailable && date >= today}
								<span class="mt-0.5 text-[11px] leading-tight">{closedDates.has(date) ? m.cal_closed() : '—'}</span>
							{/if}
						</button>
					{/each}
				</div>
			</section>
		{/each}
	</div>
	<div class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
		<p class="text-sm text-stone-700">
			{#if checkin}{m.datepanel_range({ checkin: formatDate(checkin), checkout: formatDate(checkout), n: String(nights) })}{:else}{m.bath_select_date()}{/if}
			<span class="ml-2 text-xs text-stone-400">{m.datepanel_unavailable()}</span>
		</p>
		<button type="button" disabled={!checkin} onclick={onApply} class="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40">{m.datepanel_apply()}</button>
	</div>
</div>
