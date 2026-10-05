<script lang="ts">
	// 客室・プラン一覧の「空室カレンダー」（部屋カードから開く）。
	// 月カレンダー（部屋で絞る・人数・泊数）で日を押すと、その日に予約できる部屋×プランを右（スマホは下）に出し、そのまま予約できる。
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { shiftYearMonth } from '$lib/calendar-range';
	import { formatDate, formatPrice } from '$lib/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';
	import { StayDaysLoader } from '$lib/stay-days.svelte';

	type DayOffer = {
		room: { id: string; slug: string; name: string };
		plan: { id: string; slug: string; name: string; mealPlan: string };
		total: number;
		perPersonNight: number;
		remaining: number;
	};

	let {
		open = $bindable(false),
		roomId = $bindable(''),
		base,
		facilityId,
		rooms,
		today,
		nights: initialNights,
		adults: initialAdults,
		tag,
		onRoomInfo
	}: {
		open?: boolean;
		/** 絞り込む部屋タイプ（'' = すべてのお部屋） */
		roomId?: string;
		base: string;
		facilityId: string;
		rooms: { id: string; name: string }[];
		today: string;
		nights: number;
		adults: number;
		tag: string;
		onRoomInfo: (roomId: string) => void;
	} = $props();

	const MONTHS = 6;
	// svelte-ignore state_referenced_locally
	let nights = $state(initialNights);
	// svelte-ignore state_referenced_locally
	let adults = $state(initialAdults);
	let month = $state('');
	let selected = $state('');
	let offers = $state<DayOffer[] | null>(null);
	let offersLoading = $state(false);
	let offersFailed = $state(false);
	let dayPanel = $state<HTMLElement | null>(null);
	let dialog = $state<HTMLDivElement | null>(null);

	// 開くたびに一覧の条件から始める
	$effect(() => {
		if (!open) return;
		nights = initialNights;
		adults = initialAdults;
		month = today.slice(0, 7);
		selected = '';
		offers = null;
		dialog?.focus();
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => { document.body.style.overflow = previous; };
	});

	const loader = new StayDaysLoader();
	$effect(() => {
		void roomId;
		void facilityId;
		loader.reset();
	});
	$effect(() => {
		if (open) loader.load({ facilityId, roomTypeId: roomId || undefined, months: MONTHS }, nights, adults);
	});
	const current = $derived(loader.get(nights, adults));
	const dayByDate = $derived(new Map((current?.days ?? []).map((day) => [day.date, day as { date: string; price: number | null; remaining?: number }])));

	// 日を押したら、その日の部屋×プラン
	let offersController: AbortController | null = null;
	function loadOffers() {
		if (!selected) return;
		offersController?.abort();
		const controller = new AbortController();
		offersController = controller;
		const query = new URLSearchParams({ facility: facilityId, checkin: selected, nights: String(nights), adults: String(adults) });
		if (roomId) query.set('room', roomId);
		if (tag) query.set('tag', tag);
		offersLoading = true;
		offersFailed = false;
		fetch(`/api/day-offers?${query}`, { signal: controller.signal })
			.then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
			.then((result: { offers: DayOffer[] }) => {
				if (offersController !== controller) return;
				offers = result.offers;
				offersLoading = false;
			})
			.catch((reason) => {
				if (offersController !== controller) return;
				offersLoading = false;
				offersFailed = true;
				console.error('[AvailabilityCalendarModal] day-offers', reason);
			});
	}
	// 日を選んだとき・条件（部屋・人数・泊数）を変えたときに、その日の部屋×プランを取る
	$effect(() => {
		void roomId;
		void nights;
		void adults;
		if (open && selected) loadOffers();
	});

	async function choose(date: string) {
		selected = date;
		// スマホは日別パネルがカレンダーの下なので、そこまで送る
		await tick();
		if (window.matchMedia('(max-width: 1023px)').matches) dayPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	const locale = getLocale() === 'zh-TW' ? 'zh-TW' : getLocale() === 'en' ? 'en-US' : 'ja-JP';
	const weekdays = Array.from({ length: 7 }, (_, index) =>
		new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 8, 1 + index)))
	);
	const monthKeys = $derived(Array.from({ length: MONTHS + 1 }, (_, index) => shiftYearMonth(today.slice(0, 7), index)));
	const monthLabel = (key: string, style: 'long' | 'short') => {
		const [year, number] = key.split('-').map(Number);
		return new Intl.DateTimeFormat(locale, style === 'long' ? { year: 'numeric', month: 'long', timeZone: 'UTC' } : { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, number - 1, 1)));
	};
	const grid = $derived.by(() => {
		if (!month) return { offset: 0, dates: [] as string[] };
		const [year, number] = month.split('-').map(Number);
		const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
		return {
			offset: new Date(Date.UTC(year, number - 1, 1)).getUTCDay(),
			dates: Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
		};
	});
	// その月の最安（「最安」バッジ）
	const monthMin = $derived.by(() => {
		let min: number | null = null;
		for (const date of grid.dates) {
			const price = dayByDate.get(date)?.price;
			if (price != null && price > 0 && (min === null || price < min)) min = price;
		}
		return min;
	});
	// 「選び直す」・パンくずの戻り先: カレンダーで選んだ日程・人数の一覧
	const listHref = $derived.by(() => {
		const query = new URLSearchParams(page.url.searchParams);
		query.set('checkin', selected);
		query.set('nights', String(nights));
		query.set('adults', String(adults));
		return `${page.url.pathname}?${query}`;
	});
	const planHref = (offer: DayOffer) => {
		const query = new URLSearchParams({ checkin: selected, nights: String(nights), adults: String(adults), room: offer.room.slug });
		return `${base}/plans/${offer.plan.slug}?${query}#room-${offer.room.slug}`;
	};

	function onKeydown(event: KeyboardEvent) {
		// 客室紹介のモーダルが上に開いているときは、そちらだけ閉じる
		if (open && event.key === 'Escape' && !document.querySelector('[data-room-info]')) open = false;
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div class="fixed inset-0 z-[90] flex items-end justify-center sm:items-center" role="presentation">
		<button type="button" class="absolute inset-0 bg-stone-950/55" aria-label={m.common_close()} onclick={() => (open = false)}></button>
		<div bind:this={dialog} tabindex="-1" role="dialog" aria-modal="true" aria-label={m.room_card_calendar()} class="relative flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-stone-50 shadow-2xl outline-none sm:h-[min(90dvh,860px)] sm:w-[min(96vw,1120px)] sm:rounded-2xl">
			<div class="flex shrink-0 items-center justify-between border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
				<h2 class="font-display text-lg text-brand-900">{m.room_card_calendar()}</h2>
				<button type="button" class="flex h-9 w-9 items-center justify-center rounded-full text-xl text-stone-600 hover:bg-stone-100" aria-label={m.common_close()} onclick={() => (open = false)}>×</button>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5 lg:overflow-hidden">
				<!-- カレンダー -->
				<div class="min-w-0 lg:overflow-y-auto lg:overscroll-contain">
					<div class="rounded-xl border border-stone-200 bg-white p-3 sm:p-4">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div class="flex items-center gap-2">
								<button type="button" disabled={month <= monthKeys[0]} onclick={() => (month = shiftYearMonth(month, -1))} class="flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-30" aria-label={m.calendar_prev()}>‹</button>
								<span class="min-w-28 text-center text-lg font-semibold text-stone-900">{month ? monthLabel(month, 'long') : ''}</span>
								<button type="button" disabled={month >= monthKeys[monthKeys.length - 1]} onclick={() => (month = shiftYearMonth(month, 1))} class="flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-30" aria-label={m.calendar_next()}>›</button>
							</div>
							<div class="flex items-center gap-2 text-sm">
								<span class="text-stone-600">{m.searchbar_nights()}</span>
								<button type="button" disabled={nights <= 1} class="flex h-8 w-8 items-center justify-center rounded bg-stone-100 text-lg text-brand-800 disabled:text-stone-300" aria-label="−" onclick={() => nights--}>−</button>
								<span class="min-w-9 text-center font-medium tabular-nums">{m.searchbar_nights_option({ n: String(nights) })}</span>
								<button type="button" disabled={nights >= 7} class="flex h-8 w-8 items-center justify-center rounded bg-brand-800 text-lg text-white disabled:bg-stone-200" aria-label="+" onclick={() => nights++}>+</button>
							</div>
						</div>
						<div class="mt-3 flex flex-wrap items-center gap-1.5">
							<span class="mr-1 text-xs text-stone-500">{m.cal_adults()}</span>
							{#each [1, 2, 3, 4, 5, 6] as count}
								<button type="button" aria-pressed={adults === count} onclick={() => (adults = count)} class="rounded-full px-3 py-1 text-sm {adults === count ? 'bg-brand-900 text-white' : 'text-stone-600 hover:bg-stone-100'}">{m.searchbar_adults_option({ n: String(count) })}</button>
							{/each}
						</div>
						<div class="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
							{#each monthKeys as key}
								<button type="button" aria-pressed={month === key} onclick={() => (month = key)} class="shrink-0 rounded-full border px-3 py-1 text-xs {month === key ? 'border-amber-700 bg-amber-50 text-amber-900' : 'border-stone-200 text-stone-600 hover:border-stone-400'}">{key.endsWith('-01') || key === monthKeys[0] ? monthLabel(key, 'long') : monthLabel(key, 'short')}</button>
							{/each}
						</div>
						<div class="mt-3 flex gap-1.5 overflow-x-auto border-t border-stone-100 pt-3 sm:flex-wrap">
							<button type="button" aria-pressed={roomId === ''} onclick={() => (roomId = '')} class="shrink-0 rounded-full border px-3 py-1 text-xs {roomId === '' ? 'border-brand-900 bg-brand-900 text-white' : 'border-stone-200 text-stone-600 hover:border-stone-400'}">{m.cal_all_rooms()}</button>
							{#each rooms as room (room.id)}
								<button type="button" aria-pressed={roomId === room.id} onclick={() => (roomId = room.id)} class="shrink-0 rounded-full border px-3 py-1 text-xs {roomId === room.id ? 'border-brand-900 bg-brand-900 text-white' : 'border-stone-200 text-stone-600 hover:border-stone-400'}">{room.name}</button>
							{/each}
						</div>
					</div>
					<div class="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-stone-600">
						<span>{m.cal_note({ adults: String(adults) })}</span>
						{#if loader.loading}<span role="status" class="text-stone-500">{m.datepicker_loading()}</span>{:else if loader.failed}<span role="status" class="text-red-600">{m.datepicker_load_failed()}</span>{/if}
					</div>
					<div class="mt-2 grid grid-cols-7 overflow-hidden rounded-xl border border-stone-200 bg-white text-center">
						{#each weekdays as weekday, index}<div class="border-b border-stone-200 py-2 text-xs font-medium {index === 0 ? 'text-red-500' : index === 6 ? 'text-blue-500' : 'text-stone-600'}">{weekday}</div>{/each}
						{#each Array(grid.offset) as _}<div class="border-b border-r border-stone-100 bg-stone-50"></div>{/each}
						{#each grid.dates as date (date)}
							{@const day = dayByDate.get(date)}
							{@const price = day?.price ?? null}
							{@const known = Boolean(current?.through && date <= current.through)}
							{@const bookable = price != null && price > 0}
							{@const past = date < today}
							{@const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()}
							<button
								type="button"
								disabled={!bookable}
								aria-pressed={selected === date}
								aria-label={`${formatDate(date)}${bookable ? ` ${formatPrice(price!)}` : ''}`}
								onclick={() => choose(date)}
								class="flex min-h-[4.5rem] min-w-0 flex-col items-start border-b border-r border-stone-100 px-1 py-1 text-left transition sm:min-h-20 sm:px-2 {selected === date ? 'bg-amber-50 ring-2 ring-inset ring-amber-700' : bookable ? 'hover:bg-sky-50' : 'bg-stone-50/60'}"
							>
								<span class="text-sm tabular-nums {past ? 'text-stone-300' : weekday === 0 ? 'text-red-500' : weekday === 6 ? 'text-blue-500' : 'text-stone-800'}">{Number(date.slice(-2))}</span>
								{#if bookable}
									{#if price === monthMin}<span class="mt-0.5 rounded bg-amber-700 px-1 text-[10px] font-semibold leading-4 text-white">{m.cal_cheapest()}</span>{/if}
									<!-- スマホはマスが狭いので数字だけ（¥・〜を省く） -->
									<span class="mt-auto max-w-full text-[10px] font-medium tabular-nums tracking-tight text-stone-900 sm:hidden">{price!.toLocaleString('ja-JP')}</span>
									<span class="mt-auto hidden max-w-full truncate text-sm font-medium tabular-nums text-stone-900 sm:inline">{formatPrice(price!)}〜</span>
									{#if day?.remaining != null && day.remaining <= 2}<span class="text-[10px] font-medium text-red-600">{m.cal_left({ n: String(day.remaining) })}</span>{/if}
								{:else if known && !past}
									<span class="mt-auto text-[11px] text-stone-400">{m.cal_full()}</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>
				<!-- その日の部屋×プラン -->
				<aside bind:this={dayPanel} class="mt-4 scroll-mt-2 rounded-xl border border-stone-200 bg-white lg:mt-0 lg:flex lg:min-h-0 lg:flex-col">
					{#if !selected}
						<p class="p-5 text-sm leading-6 text-stone-500">{m.cal_pick_day()}</p>
					{:else}
						<div class="shrink-0 border-b border-stone-200 px-4 py-3">
							<p class="text-lg font-semibold text-stone-900">{m.cal_day_title({ date: formatDate(selected), n: String(nights) })}</p>
							<p class="text-xs text-stone-500">{m.cal_day_sub({ adults: String(adults) })}</p>
						</div>
						<div class="space-y-3 p-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
							{#if offersLoading && !offers}
								<p role="status" class="p-2 text-sm text-stone-500">{m.datepicker_loading()}</p>
							{:else if offersFailed}
								<p role="status" class="p-2 text-sm text-red-600">{m.datepicker_load_failed()}</p>
							{:else if offers && offers.length === 0}
								<p class="p-2 text-sm text-stone-500">{m.cal_no_offers()}</p>
							{:else if offers}
								{#each offers as offer (offer.room.id + offer.plan.id)}
									<div class="overflow-hidden rounded-lg border border-stone-200 {offersLoading ? 'opacity-50' : ''}">
										<div class="flex items-start justify-between gap-2 bg-stone-100 px-3 py-2">
											<div class="min-w-0">
												<p class="text-sm font-semibold leading-snug text-stone-900">{offer.room.name}</p>
												<button type="button" onclick={() => onRoomInfo(offer.room.id)} class="text-xs text-brand-700 underline underline-offset-2 hover:text-brand-900">{m.room_card_info()}</button>
											</div>
											{#if offer.remaining <= 3}<span class="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">{m.cal_left({ n: String(offer.remaining) })}</span>{/if}
										</div>
										<div class="flex items-end justify-between gap-3 px-3 py-3">
											<div class="min-w-0">
												<p class="text-sm leading-snug text-stone-900">{offer.plan.name}</p>
												<a href={planHref(offer)} class="text-xs text-brand-700 underline underline-offset-2 hover:text-brand-900">{m.cal_plan_info()}</a>
												{#if offer.plan.mealPlan}<span class="mt-1 block w-fit rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600">{offer.plan.mealPlan}</span>{/if}
											</div>
											<div class="shrink-0 text-right">
												<p class="text-lg font-bold leading-tight text-brand-900">{formatPrice(offer.perPersonNight)}<span class="text-xs font-normal text-stone-500">{m.cal_per_person()}</span></p>
												<p class="text-[11px] text-stone-500">{m.cal_per_room({ total: formatPrice(offer.total) })}</p>
												<!-- その場で仮押さえして予約入力へ（「選び直す」はこの一覧に戻る） -->
												<form method="POST" action="{base}/plans/{offer.plan.slug}?/hold" class="mt-1.5">
													<input type="hidden" name="planId" value={offer.plan.id} />
													<input type="hidden" name="roomTypeId" value={offer.room.id} />
													<input type="hidden" name="checkin" value={selected} />
													<input type="hidden" name="nights" value={nights} />
													<input type="hidden" name="adults" value={adults} />
													<input type="hidden" name="back" value={listHref} />
													<input type="hidden" name="via" value={listHref} />
													<button type="submit" class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-500">{m.cal_book()}</button>
												</form>
											</div>
										</div>
									</div>
								{/each}
							{/if}
						</div>
					{/if}
				</aside>
			</div>
		</div>
	</div>
{/if}
