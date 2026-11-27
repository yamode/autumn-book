<script lang="ts">
	import { mealChipLabel } from '$lib/meal-label';
	import BackLink from '$lib/components/BackLink.svelte';
	import { enhance } from '$lib/enhance';
	import { formatDateLong, todayStr } from '$lib/format';
	import { roomCapacityText } from '$lib/room-capacity';
	import PlanAccessBadge from '$lib/components/PlanAccessBadge.svelte';
	import { navigating, page } from '$app/state';
	import { slide, fade } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import { pendingParamOnly } from '$lib/page-transition';
	import { cubicOut } from 'svelte/easing';
	import SiteSearchBar from '$lib/components/SiteSearchBar.svelte';
	import RoomInfoModal from '$lib/components/RoomInfoModal.svelte';
	import AvailabilityCalendarModal from '$lib/components/AvailabilityCalendarModal.svelte';
	import PrivateBookPriceNote from '$lib/components/booking/PrivateBookPriceNote.svelte';
	import { searchQuery } from '$lib/components/guests';
	import { facilityThumbnailUrl } from '$lib/facility-thumbnail';
	import { formatPrice } from '$lib/format';
	import { goto, pushState } from '$app/navigation';
	import { writeCart, type CartItem } from '$lib/multi-room';
	import { pbCartStorageKey } from '$lib/private-book';
	import { experimentVariant } from '$lib/experiments';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import RefreshingResults from '$lib/components/RefreshingResults.svelte';
	import type { RoomType } from '$lib/types';
	import type { MealOption } from '$lib/meal-filter';

	// 予約に絞った構成（一休型）: 検索バー → 絞り込み・並び順 → 部屋タイプごとの全幅カード → 施設について
	import { getPrivateBookDisplay } from '$lib/private-book-display';

	let { data: serverData, form } = $props();
	const previewRates = getPrivateBookDisplay<typeof serverData>();
	const data = $derived(previewRates(serverData));
	const alertError = $derived(form && 'alertError' in form ? form.alertError : undefined);
	let base = $derived(`/${data.facility.brandSlug}/${data.facility.slug}`);
	let facilitiesHref = $derived(data.params.checkin ? `/search?${searchQuery(data.params)}` : '/search');
	const today = todayStr();
	let expandedRooms = $state<Record<string, boolean>>({});
	let calendarOpen = $state(false);
	let calendarRoomId = $state('');
	let infoRoom = $state<RoomType | null>(null);
	let sort = $state<'asc' | 'desc'>('asc');
	let headingVariant = $derived(experimentVariant(page.data.abExperiments, 'facility-plans-heading'));

	type RoomItem = (typeof data.rooms)[number];
	type PlanOption = RoomItem['plans'][number];

	// 並べ替えの基準: 1名1泊（日付指定時は合計から割り戻し、未指定は参考料金）
	function perPersonNight(option: PlanOption): number | null {
		if (option.total !== null) return Math.round(option.total / (data.params.adults * data.params.nights));
		return option.referencePrice !== null && option.referencePrice > 0 ? option.referencePrice : null;
	}
	function byPrice(a: number | null, b: number | null) {
		if (a === null) return b === null ? 0 : 1;
		if (b === null) return -1;
		return sort === 'asc' ? a - b : b - a;
	}
	const activeSpecialOnly = $derived(Boolean(data.privateBook) && (page.state.privateBookSpecialOnly ?? (page.url.searchParams.get('specialOnly') === '1')));
	const combos = $derived(activeSpecialOnly ? data.specialCombos : data.combos);
	let rooms = $derived.by(() =>
		data.rooms
			.map((item) => ({ ...item, plans: (activeSpecialOnly ? item.plans.filter((plan) => plan.special) : [...item.plans]).sort((a, b) => byPrice(perPersonNight(a), perPersonNight(b))) }))
			.filter((item) => !activeSpecialOnly || item.plans.length > 0)
			.sort((a, b) => {
				const priceA = a.plans.length ? perPersonNight(a.plans[0]) : null;
				const priceB = b.plans.length ? perPersonNight(b.plans[0]) : null;
				return Number(b.plans.length > 0) - Number(a.plans.length > 0) || byPrice(priceA, priceB);
			})
	);

	// 日付を選んでいるときは、満室（この条件で予約できるプランが無い）の部屋タイプを見出しを分けて下に出す（2026-11-23 指示）
	let openRooms = $derived(data.params.checkin ? rooms.filter((item) => item.plans.length > 0) : rooms);
	let fullRooms = $derived(data.params.checkin ? rooms.filter((item) => item.plans.length === 0) : []);
	const ROOM_CARD = 'overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm md:grid md:grid-cols-[280px_minmax(0,1fr)] md:rounded-2xl';

	// お食事の絞り込みだけを変えている間の行き先（それ以外の移動中・止まっているときは null）。
	// このときは結果の欄ごと読み込み表示にせず、ボタンをすぐ切り替え、各部屋のプランの欄だけを薄くして、届いたらフェードインで入れ替える（2026-11-21 指示）
	const pendingMeal = $derived(pendingParamOnly('meal', listUrl()));
	const activeMeal = $derived(pendingMeal ?? data.params.meal);
	const resultFade = $derived(prefersReducedMotion.current ? 0 : 140);
	const planSlide = $derived(prefersReducedMotion.current ? 0 : 170);
	const roomFlip = $derived(prefersReducedMotion.current ? 0 : 300);

	// 専用料金の切り替え後も同じプランが残るときは、新しい料金が届いてから行を短くフェードインする。
	function animateRateMode(row: HTMLElement, partnerId: string | null) {
		let animation: Animation | undefined;
		return {
			update(nextPartnerId: string | null) {
				if (nextPartnerId === partnerId) return;
				partnerId = nextPartnerId;
				animation?.cancel();
				if (prefersReducedMotion.current) return;
				animation = row.animate(
					[{ opacity: 0.4, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }],
					{ duration: planSlide, easing: 'ease-out' }
				);
			},
			destroy() { animation?.cancel(); }
		};
	}

	function listQuery(specialOnly = activeSpecialOnly) {
		const query = new URLSearchParams(page.url.searchParams);
		if (specialOnly) query.set('specialOnly', '1');
		else query.delete('specialOnly');
		return query;
	}

	function listUrl(specialOnly = activeSpecialOnly) {
		const url = new URL(page.url);
		url.search = listQuery(specialOnly).toString();
		return url;
	}

	function filterSpecialOnly(checked: boolean) {
		pushState(listUrl(checked), { ...page.state, privateBookSpecialOnly: checked });
	}

	// お食事で絞り込む（プラン設定の「お食事」から自動で作る・lib/meal-filter.ts）。'' はすべて
	function mealHref(key: string) {
		const query = listQuery();
		query.delete('tag'); // 以前のタグ絞り込みの URL は捨てる
		if (key) query.set('meal', key);
		else query.delete('meal');
		return `${base}/plans?${query}`;
	}
	// チップ列の左右に続きがあるか（ある側だけ端をぼかす）
	let mealStrip = $state<HTMLDivElement | null>(null);
	let mealEdges = $state({ left: false, right: false });
	function updateMealEdges() {
		if (!mealStrip) return;
		const { scrollLeft, scrollWidth, clientWidth } = mealStrip;
		mealEdges = { left: scrollLeft > 1, right: scrollLeft + clientWidth < scrollWidth - 1 };
	}
	let mealMask = $derived.by(() => {
		if (!mealEdges.left && !mealEdges.right) return '';
		const gradient = `linear-gradient(to right, ${mealEdges.left ? 'transparent, #000 24px' : '#000'}, ${mealEdges.right ? '#000 calc(100% - 32px), transparent' : '#000'})`;
		return `mask-image: ${gradient}; -webkit-mask-image: ${gradient};`;
	});
	// 選んだチップが画面の外なら見える位置へ（ページは縦に動かさず、列だけ横に動かす）
	$effect(() => {
		void data.params.meal;
		const strip = mealStrip;
		if (!strip) return;
		const active = strip.querySelector<HTMLElement>('[aria-current="true"]');
		if (active && (active.offsetLeft < strip.scrollLeft || active.offsetLeft + active.offsetWidth > strip.scrollLeft + strip.clientWidth)) {
			strip.scrollLeft = active.offsetLeft - 16;
		}
		updateMealEdges();
	});
	function mealLabel(option: MealOption) {
		const kind = {
			half: m.meal_filter_half(),
			dinner: m.plan_meal_dinner(),
			breakfast: m.plan_meal_breakfast(),
			none: m.meal_filter_none(),
			dayuse: m.meal_filter_dayuse()
		}[option.kind];
		return option.course ? `${kind}${getLocale() === 'ja' ? '・' : ' · '}${option.course}` : kind;
	}

	function planHref(slug: string, roomSlug: string) {
		const query = listQuery();
		query.delete('tag');
		query.delete('meal');
		query.set('room', roomSlug);
		// 一覧から開いたときはページの先頭（プランの説明）から見せる。選んだ部屋の位置へは移動しない（2026-10-29 指示）
		return `${base}/plans/${slug}?${query}`;
	}

	type Combo = (typeof data.combos)[number];
	// 組み合わせの各室（部屋タイプ・人数つき）を予約かごに入れて、そのプランの詳細へ。かごのバーの「予約へ進む」で全室をまとめて仮押さえする
	function bookCombo(combo: Combo) {
		const stamp = Date.now().toString(36);
		const items: CartItem[] = [];
		for (const part of combo.parts) {
			for (let i = 0; i < part.rooms; i++) {
				items.push({
					key: `${stamp}${items.length}${Math.random().toString(36).slice(2, 6)}`,
					facilityId: data.facility.id,
					brandSlug: data.facility.brandSlug,
					facilitySlug: data.facility.slug,
					facilityName: data.facility.name,
					checkin: data.params.checkin,
					nights: data.params.nights,
					planId: combo.planId,
					planSlug: combo.planSlug,
					planName: combo.planName,
					roomTypeId: part.roomTypeId,
					roomName: part.roomName,
					adults: data.params.adults,
					total: part.roomTotal,
					pay: combo.pay,
					remaining: part.remaining
				});
			}
		}
		try {
			writeCart(sessionStorage, items, pbCartStorageKey(data.privateBookPartnerId));
		} catch {
			/* 保存できない環境では、プラン詳細で入れ直してもらう */
		}
		// 部屋数も渡す（プラン詳細の予約リストのバーに「N部屋中 M部屋 選択済み」を出すため）
		const query = new URLSearchParams({ checkin: data.params.checkin, nights: String(data.params.nights), adults: String(data.params.adults), rooms: String(data.params.rooms) });
		void goto(`${base}/plans/${combo.planSlug}?${query}`);
	}

	function roomPhoto(room: RoomItem['room']) {
		return room.photos[0]?.url ?? data.facility.photos.find((photo) => photo.category === 'room')?.url ?? facilityThumbnailUrl(data.facility.slug, data.facility.photos[0]?.url ?? '');
	}

	// 部屋カードの「空室カレンダー」: その部屋で絞った月カレンダーを開く
	function openCalendar(roomId: string) {
		calendarRoomId = roomId;
		calendarOpen = true;
	}
</script>

<svelte:window onresize={updateMealEdges} />

{#snippet roomCard(item: RoomItem)}
			<div class="border-b border-stone-200 md:border-b-0 md:border-r">
				<button type="button" onclick={() => (infoRoom = item.room)} class="block w-full" aria-label={`${item.room.name} ${m.room_card_info()}`}>
					<img src={roomPhoto(item.room)} alt={item.room.name} class="aspect-[16/9] w-full object-cover md:aspect-[16/11]" loading="lazy" />
				</button>
				<div class="p-4 sm:p-5">
					{#if data.favoriteRoomTypeIds.includes(item.room.id)}
						<!-- 会員のお気に入りの部屋がある部屋タイプ（マイページのお気に入りで登録） -->
						<span class="mb-1 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600" title={m.favorites_room_type_badge_title()}>♥ {m.favorites_room_type_badge()}</span>
					{/if}
					<h3 class="font-display text-lg leading-snug text-brand-900">{item.room.name}</h3>
					<p class="mt-2 text-xs text-stone-500">{roomCapacityText(item.room)}</p>
					{#if item.room.amenities.length}
						<div class="mt-2 flex flex-wrap gap-1.5">
							{#each item.room.amenities.slice(0, 3) as amenity}<span class="rounded bg-stone-100 px-2 py-1 text-[11px] text-stone-600">{amenity}</span>{/each}
						</div>
					{/if}
					<div class="mt-3 grid grid-cols-2 gap-2 md:grid-cols-1">
						<button type="button" onclick={() => (infoRoom = item.room)} class="rounded-md border border-stone-300 px-3 py-2 text-left text-xs font-medium text-stone-700 hover:border-brand-800 hover:text-brand-800">ⓘ {m.room_card_info()}</button>
						<button type="button" onclick={() => openCalendar(item.room.id)} class="rounded-md border border-stone-300 px-3 py-2 text-left text-xs font-medium text-stone-700 hover:border-brand-800 hover:text-brand-800">📅 {m.room_card_calendar()}</button>
					</div>
				</div>
			</div>
			<!-- プランの欄（お食事の絞り込みのときはここだけが薄くなり、届いたらフェードインで入れ替わる） -->
			<div class="min-w-0 transition-opacity duration-200 ease-out motion-reduce:transition-none {pendingMeal !== null ? 'opacity-30' : 'opacity-100'}" aria-busy={pendingMeal !== null || undefined}>
			{#key data.params.meal}
			<div in:fade={{ duration: planSlide }}>
				{#if item.plans.length}
					<div id="plans-{item.room.id}" class="divide-y divide-stone-200">
						{#each item.plans.slice(0, expandedRooms[item.room.id] ? item.plans.length : 2) as option (option.plan.id)}
							<!-- 絞り込みや「プランをすべて見る」で増減するプランだけを開閉する -->
							<div use:animateRateMode={data.privateBookPartnerId} transition:slide={{ duration: planSlide, easing: cubicOut }} class="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:p-6">
								<div class="min-w-0">
									<div class="mb-2 flex flex-wrap gap-1.5 text-[11px]">
										{#if option.plan.mealPlan}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{mealChipLabel(option.plan)}</span>{/if}
										{#if option.plan.payment.onsite}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{m.pay_onsite()}</span>{/if}
										{#if option.plan.payment.prepay}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{m.plan_card_payment_card()}</span>{/if}
										{#if option.plan.payment.checkout}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{m.plan_card_payment_checkout()}</span>{/if}
									</div>
									{#if option.plan.access}<PlanAccessBadge access={option.plan.access} size="sm" />{/if}
									<h4 class="font-medium leading-6 text-stone-900">{option.plan.name}</h4>
									{#if option.plan.headline && option.plan.headline !== option.plan.name}<p class="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{option.plan.headline}</p>{/if}
									<p class="mt-2 text-xs text-stone-600">
										<span class="font-semibold">IN</span> {data.facility.checkinTime}　<span class="font-semibold">OUT</span> {data.facility.checkoutTime}
										{#if option.remaining !== null && option.remaining > 0 && option.remaining <= 3}
											<span class="ml-2 font-semibold text-red-600">{m.plans_remaining_rooms({ n: String(option.remaining) })}</span>
										{/if}
									</p>
								</div>
								<div class="flex items-end justify-between gap-3 border-t border-stone-100 pt-3 sm:flex-col sm:items-end sm:border-0 sm:pt-0">
									<div class="sm:text-right">
										{#if option.special}
											<!-- プライベートブックの特別料金（専用ページの料金ルール）で出している組 -->
											<span class="mb-0.5 inline-block rounded-full bg-brand-900 px-2 py-0.5 text-[10px] tracking-wider text-white">{m.private_book_special_price()}</span>
										{/if}
										{#if option.total !== null}
											<p class="text-xl font-bold text-brand-900">{formatPrice(Math.round(option.total / (data.params.adults * data.params.nights)))}〜</p>
											<p class="text-[11px] text-stone-500">{m.price_unit_pp_night()}</p>
											<p class="text-[11px] text-stone-500">{m.plan_card_per_room({ adults: String(data.params.adults), nights: String(data.params.nights), total: formatPrice(option.total) })}</p>
										{:else if option.referencePrice !== null && option.referencePrice > 0}
											<p class="text-xl font-bold text-brand-900">{formatPrice(option.referencePrice)}〜</p>
											<p class="text-[11px] text-stone-500">{m.price_unit_pp_night()}</p>
										{:else}
											<p class="text-xs text-stone-500">{m.plans_room_price_unavailable()}</p>
										{/if}
									</div>
									<a href={planHref(option.plan.slug, item.room.slug)} class="shrink-0 rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800">{m.plans_room_details()}</a>
								</div>
							</div>
						{/each}
					</div>
					{#if item.plans.length > 2}
						<div class="border-t border-stone-200 p-4 text-center sm:text-right">
							<button type="button" aria-controls="plans-{item.room.id}" aria-expanded={!!expandedRooms[item.room.id]} onclick={() => (expandedRooms[item.room.id] = !expandedRooms[item.room.id])} class="w-full rounded-md border border-stone-300 px-5 py-2.5 text-sm font-semibold text-brand-800 hover:border-brand-800 hover:bg-brand-50 sm:w-auto sm:min-w-72">
								{expandedRooms[item.room.id] ? m.plans_room_collapse() : m.plans_room_show_all({ count: String(item.plans.length) })}
								<span aria-hidden="true" class="ml-2 inline-block align-[-0.2em] transition {expandedRooms[item.room.id] ? 'rotate-180' : ''}"><svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg></span>
							</button>
						</div>
					{/if}
				{:else}
					<div class="space-y-3 p-5 text-sm sm:p-6">
						<p class="leading-6 text-stone-500">{m.plans_room_no_availability()}</p>
						{#if data.params.checkin > today}
							{#if form?.alertRoom === item.room.id && form?.alertSaved}
								<p role="status" class="text-emerald-800">{m.plans_alert_registered()}</p>
								<a href="/account/availability-alerts" class="inline-flex min-h-11 items-center underline">{m.plans_alert_view_registered()}</a>
							{:else if page.data.user?.role === 'member'}
								<details open={form?.alertRoom === item.room.id && Boolean(alertError)}>
									<summary class="flex min-h-11 w-fit cursor-pointer items-center rounded-lg border border-brand-800 px-4 font-medium text-brand-900">{m.plans_alert_register()}</summary>
									<form method="POST" action="?/registerAlert&{searchQuery(data.params)}" use:enhance class="mt-3 space-y-2">
										<input type="hidden" name="facility" value={data.facility.id} />
										<input type="hidden" name="room" value={item.room.id} />
										<input type="hidden" name="checkin" value={data.params.checkin} />
										<input type="hidden" name="nights" value={data.params.nights} />
										<input type="hidden" name="adults" value={data.params.adults} />
										<input type="hidden" name="rooms" value={data.params.rooms} />
										{#if form?.alertRoom === item.room.id && alertError}<p role="alert" class="text-red-700">{alertError}</p>{/if}
										<label class="flex items-start gap-2"><input name="consent" type="checkbox" value="yes" required class="mt-1" />{m.plans_alert_consent_label()}</label>
										<button class="min-h-11 rounded-lg bg-brand-800 px-4 font-medium text-white">{m.plans_alert_submit()}</button>
									</form>
								</details>
							{:else}
								<a href={'/auth/login?next=' + encodeURIComponent(page.url.pathname + page.url.search)} class="inline-flex min-h-11 items-center rounded-lg border border-brand-800 px-4 font-medium text-brand-900">{m.plans_alert_login()}</a>
							{/if}
						{/if}
					</div>
				{/if}
			</div>
			{/key}
			</div>
{/snippet}


<svelte:head>
	<title>{m.plans_title({ name: data.facility.name })}</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4 pt-4 pb-6 sm:pt-5 sm:pb-8">
	<header class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
		<div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
			<h1 class="font-display text-2xl leading-tight text-brand-900 sm:text-3xl">{data.facility.name}</h1>
			{#if data.facility.catchCopy}<p class="text-sm text-stone-600">{data.facility.catchCopy}</p>{/if}
		</div>
		<p class="text-xs text-stone-600">{data.facility.prefecture}{#if data.facility.addressPublic} · {data.facility.addressPublic}{/if} · IN {data.facility.checkinTime} / OUT {data.facility.checkoutTime}</p>
	</header>

	<div class="mt-2 flex flex-wrap items-center justify-between gap-x-3 border-b border-stone-200">
		<nav class="flex min-w-0 gap-1 text-sm" aria-label={m.plans_view_switch()}>
			<span class="-mb-px inline-flex min-h-11 items-center border-b-2 border-brand-800 px-2 font-medium text-brand-900 sm:px-3" aria-current="page">{m.plans_tab_plans()}</span>
			<a href="{base}/rooms" class="-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-2 text-stone-600 hover:text-brand-900 sm:px-3">{m.plans_tab_rooms()}</a>
		</nav>
		<BackLink href={facilitiesHref} target={m.common_facility_list()} inline />
	</div>

	<div id="plan-search" class="mt-3 scroll-mt-28">
		<SiteSearchBar action="{base}/plans" facility={data.facility.slug} checkin={data.params.checkin} nights={data.params.nights} adults={data.params.adults} rooms={data.params.rooms} meal={data.params.meal} specialOnly={activeSpecialOnly} keepScroll compact />
		<PrivateBookPriceNote view={data.privateBook} compact />
		{#if data.privateBook || data.meals.length > 1}
			<div role="group" aria-label={m.plans_filters_label()} class="mt-3 divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-stone-50/80 px-3 sm:px-4">
				{#if data.privateBook}
					<div class="flex min-w-0 items-center gap-2 py-2 sm:gap-3">
						<span class="w-14 shrink-0 text-xs font-medium text-stone-600 sm:w-20">{m.plans_rate_filter_label()}</span>
						<label class="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-xs font-medium text-brand-900 transition-colors sm:text-sm {activeSpecialOnly ? 'border-brand-900/30 bg-brand-900/5' : 'border-transparent hover:bg-white'}">
							<input type="checkbox" class="h-4 w-4 shrink-0 accent-brand-900" checked={activeSpecialOnly} disabled={navigating.to !== null} onchange={(event) => filterSpecialOnly(event.currentTarget.checked)} />
							{m.private_book_filter_only()}
						</label>
					</div>
				{/if}
				{#if data.meals.length > 1}
					<div class="flex min-w-0 items-center gap-2 py-2 sm:gap-3">
						<span class="w-14 shrink-0 text-xs font-medium text-stone-600 sm:w-20">{m.meal_filter_label()}</span>
						<div bind:this={mealStrip} onscroll={updateMealEdges} style={mealMask} class="relative -mr-3 flex min-w-0 flex-1 gap-1.5 overflow-x-auto pr-3 [scrollbar-width:none] sm:mr-0 sm:flex-wrap sm:pr-0 [&::-webkit-scrollbar]:hidden" role="group" aria-label={m.meal_filter_label()}>
							{#each [{ key: '', label: m.meal_filter_all() }, ...data.meals.map((option) => ({ key: option.key, label: mealLabel(option) }))] as item (item.key)}
								<a href={mealHref(item.key)} data-sveltekit-noscroll aria-current={activeMeal === item.key ? 'true' : undefined} class="inline-flex min-h-9 shrink-0 items-center rounded-full border px-3 text-xs transition-colors {activeMeal === item.key ? 'border-brand-800 bg-brand-800 text-white' : 'border-stone-300 bg-white text-stone-700 hover:border-brand-800 hover:text-brand-800'}">{item.label}</a>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if combos.length}
		<!-- 部屋タイプ横断の組み合わせ: 1 つの部屋タイプでは室数に足りないとき -->
		<section transition:fade={{ duration: resultFade }} class="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label={m.plans_combo_title({ n: String(data.params.rooms) })}>
			<p class="text-base font-bold text-brand-900">{m.plans_combo_title({ n: String(data.params.rooms) })}</p>
			<p class="mt-0.5 text-sm text-stone-600">{m.plans_combo_desc({ n: String(data.params.rooms) })}</p>
			<ul class="mt-3 space-y-3">
				{#each combos as combo (combo.planId)}
					<li use:animateRateMode={data.privateBookPartnerId} transition:slide={{ duration: planSlide, easing: cubicOut }} class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-4 py-3">
						<div class="min-w-0">
							<p class="text-sm font-semibold text-brand-900">{combo.planName}</p>
							<p class="mt-0.5 text-base text-brand-900">{combo.parts.map((part) => `${part.roomName} ×${part.rooms}`).join(" ＋ ")}<span class="ml-2 text-sm text-stone-500">{m.plans_combo_each({ n: String(data.params.adults) })}</span></p>
							<p class="text-sm text-stone-600">{m.plans_combo_total({ nights: String(data.params.nights) })} <span class="text-lg font-bold tabular-nums text-brand-900">{formatPrice(combo.total)}</span></p>
						</div>
						<button type="button" onclick={() => bookCombo(combo)} class="min-h-11 rounded-lg bg-sky-600 px-5 text-base font-semibold text-white hover:bg-sky-700">{m.plans_combo_go()}</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section id="rooms" class="mt-6 scroll-mt-28">
		<div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
			<div class="min-w-0">
				<h2 class="font-display text-xl leading-tight text-brand-900">{headingVariant === 'b' ? m.plans_heading_alternative() : m.plans_heading()}</h2>
				{#if data.params.checkin}
					<p class="mt-1 text-sm text-stone-600">{m.plans_date_info({ checkin: formatDateLong(data.params.checkin), nights: String(data.params.nights), adults: String(data.params.adults) })}</p>
				{/if}
			</div>
			<div class="ml-auto inline-flex shrink-0 gap-0.5 rounded-full border border-stone-200 bg-stone-50 p-0.5 text-xs" role="group" aria-label={m.plans_sort_label()}>
				{#each [['asc', m.plans_sort_asc()], ['desc', m.plans_sort_desc()]] as [value, label]}
					<button type="button" aria-pressed={sort === value} onclick={() => (sort = value as 'asc' | 'desc')} class="min-h-9 rounded-full px-3 {sort === value ? 'bg-white font-semibold text-brand-900 shadow-sm' : 'text-stone-600 hover:text-brand-800'}">{label}</button>
				{/each}
			</div>
		</div>

		{#if !data.params.checkin}
			<p class="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
				{data.referenceMode ? m.plans_no_date_reference({ adults: String(data.params.adults) }) : m.plans_no_date()}
			</p>
		{/if}

		<!-- 条件だけ変えたときは、この結果の欄だけを読み込み表示にする -->
		<RefreshingResults shape="plans-results" quiet={pendingMeal !== null}>
		<div class="mt-4 space-y-5 sm:space-y-6">
			{#each openRooms as item (item.room.id)}
				<article transition:fade={{ duration: resultFade }} animate:flip={{ duration: roomFlip, easing: cubicOut }} class={ROOM_CARD}>{@render roomCard(item)}</article>
			{:else}
				{#if !fullRooms.length && !combos.length}<p in:fade={{ duration: resultFade }} class="text-sm text-stone-500">{activeSpecialOnly ? m.private_book_filter_empty() : m.plans_no_results()}</p>{/if}
			{/each}
		</div>
		{#if fullRooms.length}
			<!-- 満室の部屋タイプは見出しを分けて下にまとめる（空いている部屋の並びに混ぜない・2026-11-23 指示） -->
			<div transition:fade={{ duration: resultFade }} class="mt-10 border-t border-stone-200 pt-6">
				<h3 class="font-display text-lg text-brand-900">{m.plans_unavailable_heading()}</h3>
				<p class="mt-1 text-sm text-stone-600">{m.plans_unavailable_desc()}</p>
				<div class="mt-4 space-y-5 sm:space-y-6">
					{#each fullRooms as item (item.room.id)}
						<article animate:flip={{ duration: roomFlip, easing: cubicOut }} class={ROOM_CARD}>{@render roomCard(item)}</article>
					{/each}
				</div>
			</div>
		{/if}
		</RefreshingResults>
	</section>
</div>

<AvailabilityCalendarModal
	bind:open={calendarOpen}
	bind:roomId={calendarRoomId}
	{base}
	facilityId={data.facility.id}
	rooms={data.rooms.map((item) => ({ id: item.room.id, name: item.room.name }))}
	today={data.today}
	nights={data.params.nights}
	adults={data.params.adults}
	meal={data.params.meal}
	privateBook={data.privateBook?.special === true}
	onRoomInfo={(roomId) => (infoRoom = data.rooms.find((item) => item.room.id === roomId)?.room ?? null)}
/>
<RoomInfoModal bind:room={infoRoom} pageHref={(room) => `${base}/rooms/${room.slug}`} />
