<script lang="ts">
	import { page } from '$app/state';
	import FacilityGallery from '$lib/components/FacilityGallery.svelte';
	import PlanSearchBar from '$lib/components/PlanSearchBar.svelte';
	import RoomInfoModal from '$lib/components/RoomInfoModal.svelte';
	import AvailabilityCalendarModal from '$lib/components/AvailabilityCalendarModal.svelte';
	import { searchQuery } from '$lib/components/guests';
	import { facilityThumbnailUrl } from '$lib/facility-thumbnail';
	import { formatPrice } from '$lib/format';
	import { experimentVariant } from '$lib/experiments';
	import * as m from '$lib/paraglide/messages';
	import type { RoomType } from '$lib/types';

	// 予約に絞った構成（一休型）: 検索バー → 絞り込み・並び順 → 部屋タイプごとの全幅カード → 施設について
	let { data } = $props();
	let base = $derived(`/${data.facility.brandSlug}/${data.facility.slug}`);
	let facilitiesHref = $derived(data.params.checkin ? `/search?${searchQuery(data.params)}` : '/search');
	let expandedRooms = $state<Record<string, boolean>>({});
	let introExpanded = $state(false);
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
	let rooms = $derived.by(() =>
		data.rooms
			.map((item) => ({ ...item, plans: [...item.plans].sort((a, b) => byPrice(perPersonNight(a), perPersonNight(b))) }))
			.sort((a, b) => {
				const priceA = a.plans.length ? perPersonNight(a.plans[0]) : null;
				const priceB = b.plans.length ? perPersonNight(b.plans[0]) : null;
				return Number(b.plans.length > 0) - Number(a.plans.length > 0) || byPrice(priceA, priceB);
			})
	);

	function tagHref(tag: string) {
		const query = new URLSearchParams(page.url.searchParams);
		if (query.get('tag') === tag) query.delete('tag');
		else query.set('tag', tag);
		return `${base}/plans?${query}`;
	}

	function planHref(slug: string, roomSlug: string) {
		const query = new URLSearchParams(page.url.searchParams);
		query.delete('tag');
		query.set('room', roomSlug);
		return `${base}/plans/${slug}?${query}#room-${roomSlug}`;
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

<svelte:head>
	<title>{m.plans_title({ name: data.facility.name })}</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-7 sm:py-10">
	<nav class="mb-4 text-xs text-stone-500" aria-label="breadcrumb">
		<a href={facilitiesHref} class="hover:underline">{m.common_facility_list()}</a> / {m.plans_breadcrumb()}
	</nav>

	<!-- 施設名と一言だけ（紹介・写真はページ下部の「施設について」へ） -->
	<header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
		<div class="min-w-0">
			<h1 class="font-display text-2xl leading-tight text-brand-900 sm:text-3xl">{data.facility.name}</h1>
			{#if data.facility.catchCopy}<p class="mt-1 text-sm text-stone-600">{data.facility.catchCopy}</p>{/if}
		</div>
		<p class="text-xs text-stone-500">⌖ {data.facility.prefecture}{data.facility.addressPublic ? ` · ${data.facility.addressPublic}` : ''} · IN {data.facility.checkinTime} / OUT {data.facility.checkoutTime}</p>
	</header>

	<div id="plan-search" class="mt-5 scroll-mt-28">
		<PlanSearchBar {base} params={data.params} today={data.today} days={data.calendarDays} through={data.calendarThrough} closed={data.calendarClosed} facilityId={data.facility.id} />
	</div>

	<section id="rooms" class="mt-6 scroll-mt-28">
		<h2 class="font-display mb-3 text-xl text-brand-900">{headingVariant === 'b' ? m.plans_heading_alternative() : m.plans_heading()}</h2>
		<div class="flex flex-wrap items-center justify-between gap-3">
			{#if data.allTags.length}
				<div class="-mx-4 flex min-w-0 flex-1 gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
					{#each data.allTags as tag}
						<a href={tagHref(tag)} data-sveltekit-noscroll class="shrink-0 rounded-full border px-3 py-1.5 text-xs transition {data.params.tag === tag ? 'border-brand-800 bg-brand-800 text-white' : 'border-stone-300 text-stone-600 hover:border-brand-800 hover:text-brand-800'}">{tag}</a>
					{/each}
				</div>
			{:else}
				<span></span>
			{/if}
			<div class="flex shrink-0 gap-4 text-sm" role="group" aria-label="sort">
				{#each [['asc', m.plans_sort_asc()], ['desc', m.plans_sort_desc()]] as [value, label]}
					<button type="button" aria-pressed={sort === value} onclick={() => (sort = value as 'asc' | 'desc')} class="border-b-2 pb-1 {sort === value ? 'border-brand-900 font-semibold text-brand-900' : 'border-transparent text-stone-500 hover:text-brand-800'}">{label}</button>
				{/each}
			</div>
		</div>

		{#if data.params.checkin}
			<p class="mt-3 text-sm text-stone-600">{m.plans_date_info({ checkin: data.params.checkin, nights: String(data.params.nights), adults: String(data.params.adults) })}</p>
		{:else}
			<p class="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
				{data.referenceMode ? m.plans_no_date_reference({ adults: String(data.params.adults) }) : m.plans_no_date()}
			</p>
		{/if}

		<div class="mt-4 space-y-5 sm:space-y-6">
			{#each rooms as item (item.room.id)}
				<article class="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm md:grid md:grid-cols-[280px_minmax(0,1fr)] md:rounded-2xl">
					<div class="border-b border-stone-200 md:border-b-0 md:border-r">
						<button type="button" onclick={() => (infoRoom = item.room)} class="block w-full" aria-label={`${item.room.name} ${m.room_card_info()}`}>
							<img src={roomPhoto(item.room)} alt={item.room.name} class="aspect-[16/9] w-full object-cover md:aspect-[16/11]" loading="lazy" />
						</button>
						<div class="p-4 sm:p-5">
							<h3 class="font-display text-lg leading-snug text-brand-900">{item.room.name}</h3>
							<p class="mt-2 text-xs text-stone-500">{m.room_card_capacity({ n: String(item.room.capacity), size: String(item.room.sizeM2) })}</p>
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
					<div class="min-w-0">
						{#if item.plans.length}
							<div id="plans-{item.room.id}" class="divide-y divide-stone-200">
								{#each item.plans.slice(0, expandedRooms[item.room.id] ? item.plans.length : 2) as option (option.plan.id)}
									<div class="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:p-6">
										<div class="min-w-0">
											<div class="mb-2 flex flex-wrap gap-1.5 text-[11px]">
												{#if option.plan.mealPlan}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{option.plan.mealPlan}</span>{/if}
												{#if option.plan.payment.onsite}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{m.pay_onsite()}</span>{/if}
												{#if option.plan.payment.prepay}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{m.plan_card_payment_card()}</span>{/if}
											</div>
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
										<span aria-hidden="true" class="ml-2 inline-block transition {expandedRooms[item.room.id] ? 'rotate-180' : ''}">⌄</span>
									</button>
								</div>
							{/if}
						{:else}
							<p class="p-6 text-sm leading-6 text-stone-500">{m.plans_room_no_availability()}</p>
						{/if}
					</div>
				</article>
			{:else}
				<p class="text-sm text-stone-500">{m.plans_no_results()}</p>
			{/each}
		</div>
	</section>

	<!-- 施設について（予約の邪魔にならないよう部屋カードの下へ） -->
	<section id="information" class="mt-14 scroll-mt-28 border-t border-stone-200 pt-8">
		<h2 class="font-display text-xl text-brand-900 sm:text-2xl">{m.plans_facility_about()}</h2>
		{#if data.facility.description}
			<p class="mt-3 max-w-3xl text-sm leading-7 text-stone-600" class:line-clamp-4={!introExpanded}>{data.facility.description}</p>
			{#if data.facility.description.length > 120}
				<button type="button" onclick={() => (introExpanded = !introExpanded)} class="mt-1 text-xs font-semibold text-brand-700 underline underline-offset-4">{introExpanded ? m.plans_mobile_intro_less() : m.plans_mobile_intro_more()}</button>
			{/if}
		{/if}
		<div class="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-y border-stone-200 py-3 text-xs text-stone-600">
			<span>IN {data.facility.checkinTime}</span><span>OUT {data.facility.checkoutTime}</span>
			{#each data.facility.amenities.slice(0, 6) as amenity}<span>{amenity}</span>{/each}
		</div>
		<div id="gallery" class="-mx-4 mt-6 scroll-mt-28 sm:mx-0">
			<h3 class="font-display mb-3 hidden text-lg text-brand-900 sm:block">{m.facility_gallery()}</h3>
			<FacilityGallery photos={data.facility.photos} cover={facilityThumbnailUrl(data.facility.slug, data.facility.photos[0]?.url ?? '')} name={data.facility.name} />
		</div>
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
	tag={data.params.tag}
	onRoomInfo={(roomId) => (infoRoom = data.rooms.find((item) => item.room.id === roomId)?.room ?? null)}
/>
<RoomInfoModal bind:room={infoRoom} pageHref={(room) => `${base}/rooms/${room.slug}`} />
