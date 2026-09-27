<script lang="ts">
	import { shiftYearMonth } from '$lib/calendar-range';
	import { formatPrice } from '$lib/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	let {
		base,
		today,
		checkin,
		nights,
		adults,
		tag,
		days
	}: {
		base: string;
		today: string;
		checkin: string;
		nights: number;
		adults: number;
		tag: string;
		days: { date: string; price: number; remaining: number }[];
	} = $props();

	let firstMonth = $derived(today.slice(0, 7));
	let lastMonth = $derived(shiftYearMonth(firstMonth, 2));
	let month = $state('');
	let displayMonth = $derived(month || firstMonth);
	$effect(() => {
		const selectedMonth = checkin.slice(0, 7);
		month = selectedMonth >= firstMonth && selectedMonth <= lastMonth ? selectedMonth : firstMonth;
	});
	let priceByDate = $derived(new Map(days.map((day) => [day.date, day])));
	let firstWeekday = $derived(new Date(`${displayMonth}-01T00:00:00Z`).getUTCDay());
	let monthDates = $derived.by(() => {
		const [year, number] = displayMonth.split('-').map(Number);
		const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
		return Array.from({ length: count }, (_, index) => `${displayMonth}-${String(index + 1).padStart(2, '0')}`);
	});
	const locale = getLocale();
	let monthLabel = $derived(new Intl.DateTimeFormat(locale === 'zh-TW' ? 'zh-TW' : locale === 'en' ? 'en-US' : 'ja-JP', { year: 'numeric', month: 'long' }).format(new Date(`${displayMonth}-01T00:00:00Z`)));
	const weekdays = Array.from({ length: 7 }, (_, index) =>
		new Intl.DateTimeFormat(locale === 'zh-TW' ? 'zh-TW' : locale === 'en' ? 'en-US' : 'ja-JP', { weekday: 'short' }).format(new Date(Date.UTC(2024, 8, 1 + index)))
	);

	function dateHref(date: string) {
		const query = new URLSearchParams({ checkin: date, nights: String(nights), adults: String(adults) });
		if (tag) query.set('tag', tag);
		return `${base}/plans?${query}#rooms`;
	}
</script>

<section class="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5" aria-label={m.facility_calendar()}>
	<div class="border-b border-stone-100 pb-4">
		<h2 class="font-display text-lg text-brand-900">{m.facility_calendar()}</h2>
		<p class="mt-1 text-xs text-stone-500">{m.facility_calendar_range()}</p>
		<form method="GET" action="{base}/plans" class="mt-4 flex flex-wrap items-end gap-2">
			{#if checkin}<input type="hidden" name="checkin" value={checkin} />{/if}
			{#if tag}<input type="hidden" name="tag" value={tag} />{/if}
			<label class="flex flex-col gap-1 text-xs text-stone-500">
				{m.searchbar_nights()}
				<select name="nights" value={nights} class="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-800">
					{#each [1, 2, 3, 4, 5, 6, 7] as count}
						<option value={count}>{m.searchbar_nights_option({ n: String(count) })}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1 text-xs text-stone-500">
				{m.searchbar_adults()}
				<select name="adults" value={adults} class="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-800">
					{#each [1, 2, 3, 4, 5, 6] as count}
						<option value={count}>{m.searchbar_adults_option({ n: String(count) })}</option>
					{/each}
				</select>
			</label>
			<button type="submit" class="rounded-md bg-brand-800 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700">{m.facility_calendar_update()}</button>
		</form>
	</div>
	<div class="flex items-center justify-between py-4">
		<button type="button" aria-label={m.calendar_prev()} disabled={displayMonth <= firstMonth} onclick={() => (month = shiftYearMonth(displayMonth, -1))} class="rounded-full border border-stone-200 px-3 py-1.5 text-stone-600 hover:bg-stone-50 disabled:opacity-30">‹</button>
		<h3 class="font-semibold text-stone-800">{monthLabel}</h3>
		<button type="button" aria-label={m.calendar_next()} disabled={displayMonth >= lastMonth} onclick={() => (month = shiftYearMonth(displayMonth, 1))} class="rounded-full border border-stone-200 px-3 py-1.5 text-stone-600 hover:bg-stone-50 disabled:opacity-30">›</button>
	</div>
	<div class="grid grid-cols-7 gap-1 text-center text-[11px]">
		{#each weekdays as weekday, index}
			<div class="pb-2 font-medium {index === 0 ? 'text-red-500' : index === 6 ? 'text-blue-500' : 'text-stone-500'}">{weekday}</div>
		{/each}
		{#each Array(firstWeekday) as _}<div></div>{/each}
		{#each monthDates as date}
			{@const offer = priceByDate.get(date)}
			{#if offer}
				<a href={dateHref(date)} class="flex min-h-14 flex-col items-center rounded-md border py-1.5 transition {checkin === date ? 'border-brand-800 bg-brand-50' : 'border-stone-200 hover:border-brand-700 hover:bg-brand-50'}">
					<span class="font-medium text-stone-800">{Number(date.slice(-2))}</span>
					<span class="mt-1 whitespace-nowrap text-[10px] text-brand-800">{formatPrice(offer.price)}〜</span>
				</a>
			{:else}
				<div class="flex min-h-14 flex-col items-center rounded-md bg-stone-50 py-1.5 text-stone-300">
					<span>{Number(date.slice(-2))}</span><span class="mt-1">—</span>
				</div>
			{/if}
		{/each}
	</div>
	<p class="mt-3 text-[11px] text-stone-500">{m.facility_calendar_price_note()}</p>
</section>
