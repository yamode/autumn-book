<script lang="ts">
	import { navigating } from '$app/state';
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
	let priceByDate = $derived(new Map(days.map((day) => [day.date, day])));
	const locale = getLocale();
	const localeTag = locale === 'zh-TW' ? 'zh-TW' : locale === 'en' ? 'en-US' : 'ja-JP';
	let months = $derived.by(() => {
		const result: { key: string; label: string; offset: number; dates: string[] }[] = [];
		for (let key = firstMonth; key <= lastMonth; key = shiftYearMonth(key, 1)) {
			const [year, number] = key.split('-').map(Number);
			const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
			result.push({
				key,
				label: new Intl.DateTimeFormat(localeTag, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, number - 1, 1))),
				offset: new Date(Date.UTC(year, number - 1, 1)).getUTCDay(),
				dates: Array.from({ length: count }, (_, index) => `${key}-${String(index + 1).padStart(2, '0')}`)
			});
		}
		return result;
	});
	const weekdays = Array.from({ length: 7 }, (_, index) =>
		new Intl.DateTimeFormat(localeTag, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 8, 1 + index)))
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
		<!-- 泊数・人数を変えたらその場で取り直す（スクロール位置はそのまま。JS無効時だけ更新ボタンを出す） -->
		<form method="GET" action="{base}/plans" data-sveltekit-noscroll data-sveltekit-keepfocus data-sveltekit-replacestate onchange={(event) => event.currentTarget.requestSubmit()} class="mt-4 flex flex-wrap items-end gap-2">
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
			<noscript><button type="submit" class="rounded-md bg-brand-800 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700">{m.facility_calendar_update()}</button></noscript>
			{#if navigating.to}<span class="pb-2 text-xs text-stone-500" role="status">{m.datepicker_loading()}</span>{/if}
		</form>
	</div>
	<div class="lg:max-h-[min(65dvh,640px)] lg:overflow-y-auto lg:overscroll-contain">
		{#each months as month (month.key)}
			<div class="pt-5">
				<h3 class="mb-4 text-center font-semibold text-stone-800">{month.label}</h3>
				<div class="grid grid-cols-7 gap-1 text-center text-[11px]">
					{#each weekdays as weekday, index}
						<div class="pb-2 font-medium {index === 0 ? 'text-red-500' : index === 6 ? 'text-blue-500' : 'text-stone-500'}">{weekday}</div>
					{/each}
					{#each Array(month.offset) as _}<div aria-hidden="true"></div>{/each}
					{#each month.dates as date (date)}
						{@const offer = priceByDate.get(date)}
						{#if offer}
							<a href={dateHref(date)} aria-label={`${date} ${formatPrice(offer.price)}〜`} class="flex min-h-16 min-w-0 flex-col items-center rounded-md border px-0.5 py-1 transition {checkin === date ? 'border-brand-800 bg-brand-50' : 'border-stone-200 hover:border-brand-700 hover:bg-brand-50'}">
								<span class="font-medium text-stone-800">{Number(date.slice(-2))}</span>
								<span class="mt-1 text-[9px] leading-none text-brand-800" aria-hidden="true">¥</span>
								<span class="max-w-full whitespace-nowrap text-[clamp(8px,2.4vw,10px)] leading-none tracking-tight text-brand-800">{offer.price.toLocaleString('ja-JP')}</span>
								<span class="text-[9px] leading-none text-brand-800" aria-hidden="true">〜</span>
							</a>
						{:else}
							<div class="flex min-h-14 flex-col items-center rounded-md bg-stone-50 py-1.5 text-stone-300">
								<span>{Number(date.slice(-2))}</span><span class="mt-1">—</span>
							</div>
						{/if}
					{/each}
				</div>
			</div>
		{/each}
	</div>
	<p class="mt-3 text-[11px] text-stone-500">{m.facility_calendar_price_note()}</p>
</section>
