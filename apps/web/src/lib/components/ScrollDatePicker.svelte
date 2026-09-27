<script lang="ts">
	import { tick } from 'svelte';
	import { addDays, formatDate, formatPrice, todayStr } from '$lib/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	let {
		open = $bindable(false),
		checkin = '',
		nights = 1,
		minDate = todayStr(),
		maxDate = addDays(minDate, 365),
		days = [],
		availableThrough = '',
		onSelect
	}: {
		open?: boolean;
		checkin?: string;
		nights?: number;
		minDate?: string;
		maxDate?: string;
		days?: { date: string; price: number | null }[];
		availableThrough?: string;
		onSelect: (date: string, nights: number) => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let selectedNights = $state(nights);
	let scrollRegion = $state<HTMLDivElement | null>(null);
	$effect(() => {
		if (open) selectedNights = nights;
	});
	$effect(() => {
		if (!open || !checkin) return;
		const selectedMonth = checkin.slice(0, 7);
		void tick().then(() => {
			if (!open || !scrollRegion || checkin.slice(0, 7) !== selectedMonth) return;
			const month = Array.from(scrollRegion.querySelectorAll<HTMLElement>('[data-month]'))
				.find((element) => element.dataset.month === selectedMonth);
			if (!month) return;
			const edgePadding = Math.max(0, (scrollRegion.clientHeight - month.offsetHeight) / 2);
			scrollRegion.style.paddingTop = `${edgePadding}px`;
			scrollRegion.style.paddingBottom = `${Math.max(edgePadding, 32)}px`;
			const monthRect = month.getBoundingClientRect();
			const regionRect = scrollRegion.getBoundingClientRect();
			scrollRegion.scrollTop +=
				monthRect.top + monthRect.height / 2 - (regionRect.top + regionRect.height / 2);
		});
	});
	$effect(() => {
		if (!open) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => { document.body.style.overflow = previous; };
	});

	const locale = getLocale() === 'zh-TW' ? 'zh-TW' : getLocale() === 'en' ? 'en-US' : 'ja-JP';
	const weekdays = Array.from({ length: 7 }, (_, index) =>
		new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 8, 1 + index)))
	);
	const months = $derived.by(() => {
		const result: { key: string; label: string; dates: string[]; offset: number }[] = [];
		let [year, month] = minDate.slice(0, 7).split('-').map(Number);
		const lastMonth = maxDate.slice(0, 7);
		while (`${year}-${String(month).padStart(2, '0')}` <= lastMonth) {
			const key = `${year}-${String(month).padStart(2, '0')}`;
			const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
			result.push({
				key,
				label: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1))),
				dates: Array.from({ length: count }, (_, index) => `${key}-${String(index + 1).padStart(2, '0')}`),
				offset: new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
			});
			month++;
			if (month > 12) { month = 1; year++; }
		}
		return result;
	});
	const priceByDate = $derived(new Map((selectedNights === nights ? days : []).map((day) => [day.date, day.price])));
	const checkout = $derived(checkin ? addDays(checkin, selectedNights) : '');

	function choose(date: string) {
		onSelect(date, selectedNights);
		open = false;
	}
</script>

<svelte:window onkeydown={(event) => { if (open && event.key === 'Escape') open = false; }} />

{#if open}
	<div class="fixed inset-0 z-[100] flex items-end justify-center sm:items-center" role="presentation">
		<button type="button" class="absolute inset-0 bg-stone-950/55" aria-label={m.common_close()} onclick={() => (open = false)}></button>
		<div role="dialog" aria-modal="true" aria-label={m.searchbar_checkin()} class="relative flex h-[min(86dvh,850px)] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:w-[min(92vw,680px)] sm:rounded-2xl">
			<div class="shrink-0 border-b border-stone-200 bg-white px-4 pb-3 pt-3 sm:px-6">
				<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200 sm:hidden"></div>
				<div class="flex items-center justify-between gap-3">
					<h2 class="font-display text-lg font-semibold text-stone-900">{m.searchbar_checkin()}</h2>
					<button type="button" class="flex h-9 w-9 items-center justify-center rounded-full text-xl text-stone-600 hover:bg-stone-100" aria-label={m.common_close()} onclick={() => (open = false)}>×</button>
				</div>
				<div class="mt-2 flex items-center gap-4">
					<span class="text-sm text-stone-600">{m.searchbar_nights()}</span>
					<button type="button" disabled={selectedNights <= 1} class="flex h-9 w-9 items-center justify-center rounded bg-stone-100 text-xl text-brand-800 disabled:text-stone-300" aria-label="−" onclick={() => selectedNights--}>−</button>
					<span class="min-w-10 text-center text-sm font-medium tabular-nums">{m.searchbar_nights_option({ n: String(selectedNights) })}</span>
					<button type="button" disabled={selectedNights >= 7} class="flex h-9 w-9 items-center justify-center rounded bg-brand-800 text-xl text-white disabled:bg-stone-200" aria-label="+" onclick={() => selectedNights++}>+</button>
				</div>
			</div>
			<div bind:this={scrollRegion} class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-8 sm:px-6">
				{#each months as month (month.key)}
					<section class="pt-6" aria-label={month.label} data-month={month.key}>
						<h3 class="mb-5 text-center text-lg font-semibold text-stone-900">{month.label}</h3>
						<div class="grid grid-cols-7 text-center text-xs font-medium">
							{#each weekdays as weekday, index}<div class="pb-3 {index === 0 ? 'text-red-500' : index === 6 ? 'text-blue-500' : 'text-stone-600'}">{weekday}</div>{/each}
							{#each Array(month.offset) as _}<div aria-hidden="true"></div>{/each}
							{#each month.dates as date (date)}
								{@const price = priceByDate.get(date)}
								{@const knownUnavailable = Boolean(selectedNights === nights && availableThrough && date <= availableThrough && (price == null || price <= 0))}
								{@const disabled = date < minDate || date > maxDate || knownUnavailable}
								{@const selected = date === checkin}
								{@const inStay = checkin && date > checkin && date <= checkout}
								<button
									type="button"
									{disabled}
									aria-label={`${formatDate(date)}${price != null && price > 0 ? ` ${formatPrice(price)}` : ''}`}
									aria-pressed={selected}
									onclick={() => choose(date)}
									class="flex min-h-16 min-w-0 flex-col items-center justify-start border-t border-stone-200 px-0.5 py-2 text-sm tabular-nums transition {selected ? 'rounded bg-sky-600 text-white' : inStay ? 'bg-sky-100 text-sky-900' : disabled ? 'text-stone-300' : 'text-stone-900 hover:bg-sky-50'}"
								>
									<span class="font-medium">{Number(date.slice(-2))}</span>
									{#if price != null && price > 0}<span class="mt-1 max-w-full text-[10px] leading-tight {selected ? 'text-white' : 'text-sky-700'}">{formatPrice(price)}</span>{:else if knownUnavailable}<span class="mt-1 text-[10px] leading-tight">—</span>{/if}
								</button>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		</div>
	</div>
{/if}
