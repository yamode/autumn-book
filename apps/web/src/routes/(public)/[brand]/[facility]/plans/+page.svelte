<script lang="ts">
	import { page } from '$app/state';
	import FacilityGallery from '$lib/components/FacilityGallery.svelte';
	import FacilityAvailabilityCalendar from '$lib/components/FacilityAvailabilityCalendar.svelte';
	import ScrollDatePicker from '$lib/components/ScrollDatePicker.svelte';
	import { searchQuery } from '$lib/components/guests';
	import { facilityThumbnailUrl } from '$lib/facility-thumbnail';
	import { formatDate, formatPrice } from '$lib/format';
	import { experimentVariant } from '$lib/experiments';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let base = $derived(`/${data.facility.brandSlug}/${data.facility.slug}`);
	let facilitiesHref = $derived(data.params.checkin ? `/search?${searchQuery(data.params)}` : '/search');
	let expandedRooms = $state<Record<string, boolean>>({});
	let introExpanded = $state(false);
	let mobileCalendarOpen = $state(false);
	let datePickerOpen = $state(false);
	// svelte-ignore state_referenced_locally
	let mobileCheckin = $state(data.params.checkin);
	// svelte-ignore state_referenced_locally
	let mobileNights = $state(data.params.nights);
	$effect(() => {
		mobileCheckin = data.params.checkin;
		mobileNights = data.params.nights;
	});
	let headingVariant = $derived(experimentVariant(page.data.abExperiments, 'facility-plans-heading'));

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

	function roomPhoto(room: (typeof data.rooms)[number]['room']) {
		return room.photos[0]?.url ?? data.facility.photos.find((photo) => photo.category === 'room')?.url ?? facilityThumbnailUrl(data.facility.slug, data.facility.photos[0]?.url ?? '');
	}
</script>

<svelte:head>
	<title>{m.plans_title({ name: data.facility.name })}</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-7 sm:py-10">
	<nav class="mb-6 text-xs text-stone-500" aria-label="breadcrumb">
		<a href={facilitiesHref} class="hover:underline">{m.common_facility_list()}</a> / {m.plans_breadcrumb()}
	</nav>

	<div class="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_390px]">
		<div class="min-w-0">
			<p class="text-xs font-semibold tracking-[0.22em] text-stone-500">YAMADO STAYS</p>
			<h1 class="font-display mt-2 text-3xl leading-tight text-brand-900 sm:text-4xl">{data.facility.name}</h1>
			<p class="mt-2 text-sm text-stone-500">⌖ {data.facility.prefecture}{data.facility.addressPublic ? ` · ${data.facility.addressPublic}` : ''}</p>
			<div class="hidden lg:block">
				{#if data.facility.catchCopy}<h2 class="font-display mt-7 text-xl leading-snug text-brand-900">{data.facility.catchCopy}</h2>{/if}
				{#if data.facility.description}<p class="mt-3 line-clamp-4 text-sm leading-7 text-stone-600">{data.facility.description}</p>{/if}
				<div class="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-y border-stone-200 py-3 text-xs text-stone-600">
					<span>IN {data.facility.checkinTime}</span><span>OUT {data.facility.checkoutTime}</span>
					{#each data.facility.amenities.slice(0, 3) as amenity}<span>{amenity}</span>{/each}
				</div>
			</div>
			<div id="gallery" class="-mx-4 mt-5 scroll-mt-28 sm:mx-0 sm:mt-7">
				<h2 class="font-display mb-3 hidden text-lg text-brand-900 sm:block">{m.facility_gallery()}</h2>
				<FacilityGallery photos={data.facility.photos} cover={facilityThumbnailUrl(data.facility.slug, data.facility.photos[0]?.url ?? '')} name={data.facility.name} />
			</div>
			<nav class="mt-5 grid grid-cols-3 border-y border-stone-200 text-center text-xs font-medium text-brand-800 lg:hidden" aria-label={m.plans_breadcrumb()}>
				<a href="#information" class="py-3 hover:bg-brand-50">{m.facility_info()}</a>
				<a href="#rooms" class="border-x border-stone-200 py-3 hover:bg-brand-50">{m.plans_heading()}</a>
				<a href="#availability-mobile" onclick={() => (mobileCalendarOpen = true)} class="py-3 hover:bg-brand-50">{m.facility_calendar()}</a>
			</nav>
			<div id="information" class="scroll-mt-28 lg:hidden">
				{#if data.facility.catchCopy}
					<h2 class="font-display mt-7 text-xl leading-snug text-brand-900">{data.facility.catchCopy}</h2>
				{/if}
				{#if data.facility.description}
					<p class="mt-3 text-sm leading-7 text-stone-600 lg:line-clamp-none" class:line-clamp-3={!introExpanded}>{data.facility.description}</p>
					{#if data.facility.description.length > 100}
						<button type="button" onclick={() => (introExpanded = !introExpanded)} class="mt-1 text-xs font-semibold text-brand-700 underline underline-offset-4 lg:hidden">{introExpanded ? m.plans_mobile_intro_less() : m.plans_mobile_intro_more()}</button>
					{/if}
				{/if}
				<div class="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-y border-stone-200 py-3 text-xs text-stone-600">
					<span>IN {data.facility.checkinTime}</span>
					<span>OUT {data.facility.checkoutTime}</span>
					{#each data.facility.amenities.slice(0, 3) as amenity}
						<span>{amenity}</span>
					{/each}
				</div>
			</div>
			<div id="availability-mobile" class="mt-7 scroll-mt-28 lg:hidden">
				<div class="rounded-xl border border-stone-200 bg-brand-50 p-4">
					<h2 class="font-display text-lg text-brand-900">{m.searchbar_submit()}</h2>
					<form method="GET" action="{base}/plans" class="mt-4 grid grid-cols-2 gap-3">
						{#if data.params.tag}<input type="hidden" name="tag" value={data.params.tag} />{/if}
						<div class="col-span-2 flex flex-col gap-1 text-xs text-stone-600">
							<span>{m.searchbar_checkin()}</span>
							<input type="hidden" name="checkin" value={mobileCheckin} />
							<button type="button" onclick={() => (datePickerOpen = true)} class="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-left text-base text-stone-800">📅 {mobileCheckin ? formatDate(mobileCheckin) : m.bath_select_date()}</button>
						</div>
						<label class="flex flex-col gap-1 text-xs text-stone-600">
							{m.searchbar_nights()}
							<select name="nights" bind:value={mobileNights} class="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-800">
								{#each [1, 2, 3, 4, 5, 6, 7] as count}<option value={count}>{m.searchbar_nights_option({ n: String(count) })}</option>{/each}
							</select>
						</label>
						<label class="flex flex-col gap-1 text-xs text-stone-600">
							{m.searchbar_adults()}
							<select name="adults" value={data.params.adults} class="min-h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-800">
								{#each [1, 2, 3, 4, 5, 6] as count}<option value={count}>{m.searchbar_adults_option({ n: String(count) })}</option>{/each}
							</select>
						</label>
						<button type="submit" disabled={!mobileCheckin} class="col-span-2 min-h-11 rounded-lg bg-brand-800 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40">{m.searchbar_submit()}</button>
					</form>
					<ScrollDatePicker bind:open={datePickerOpen} checkin={mobileCheckin} nights={mobileNights} minDate={data.today} days={data.calendarDays} availableThrough={data.calendarThrough} daysNights={data.params.nights} source={{ facilityId: data.facility.id, adults: data.params.adults }} onSelect={(date, nights) => { mobileCheckin = date; mobileNights = nights; }} />
					<button type="button" aria-expanded={mobileCalendarOpen} onclick={() => (mobileCalendarOpen = !mobileCalendarOpen)} class="mt-4 w-full border-t border-stone-200 pt-3 text-center text-sm font-semibold text-brand-700">
						{mobileCalendarOpen ? m.plans_mobile_calendar_close() : m.plans_mobile_calendar_open()} <span aria-hidden="true">{mobileCalendarOpen ? '⌃' : '⌄'}</span>
					</button>
				</div>
				{#if mobileCalendarOpen}
					<div class="mt-3"><FacilityAvailabilityCalendar {base} today={data.today} checkin={data.params.checkin} nights={data.params.nights} adults={data.params.adults} tag={data.params.tag} days={data.calendarDays} /></div>
				{/if}
			</div>
		</div>
		<div class="hidden lg:sticky lg:top-28 lg:block">
			<FacilityAvailabilityCalendar
				{base}
				today={data.today}
				checkin={data.params.checkin}
				nights={data.params.nights}
				adults={data.params.adults}
				tag={data.params.tag}
				days={data.calendarDays}
			/>
		</div>
	</div>

	<section id="rooms" class="mt-10 scroll-mt-28 border-t border-stone-200 pt-8 sm:mt-20">
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<p class="text-xs font-semibold tracking-[0.22em] text-stone-500">ROOMS & PLANS</p>
				<h2 class="font-display mt-2 text-2xl text-brand-900 sm:text-3xl">{headingVariant === 'b' ? m.plans_heading_alternative() : m.plans_heading()}</h2>
			</div>
			<span class="text-sm tabular-nums text-stone-500">{data.rooms.length}</span>
		</div>
		{#if data.params.checkin}
			<p class="mt-4 text-sm text-stone-600">{m.plans_date_info({ checkin: data.params.checkin, nights: String(data.params.nights), adults: String(data.params.adults) })}</p>
		{:else}
			<p class="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
				{data.referenceMode ? m.plans_no_date_reference({ adults: String(data.params.adults) }) : m.plans_no_date()}
			</p>
		{/if}

		{#if data.allTags.length}
			<div class="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0">
				{#each data.allTags as tag}
					<a href={tagHref(tag)} class="shrink-0 rounded-full border px-3 py-1.5 text-xs transition {data.params.tag === tag ? 'border-brand-800 bg-brand-800 text-white' : 'border-stone-300 text-stone-600 hover:border-brand-800 hover:text-brand-800'}">{tag}</a>
				{/each}
			</div>
		{/if}

		<div class="mt-5 space-y-5 sm:mt-7 sm:space-y-6">
			{#each data.rooms as item (item.room.id)}
				<article class="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm lg:grid lg:grid-cols-[290px_minmax(0,1fr)] lg:rounded-2xl">
					<div class="border-b border-stone-200 lg:border-b-0 lg:border-r">
						<img src={roomPhoto(item.room)} alt={item.room.name} class="aspect-[16/9] w-full object-cover lg:aspect-[16/10]" loading="lazy" />
						<div class="p-4 sm:p-5">
							<h3 class="font-display text-lg leading-snug text-brand-900 sm:text-xl">{item.room.name}</h3>
							{#if item.room.headline}<p class="mt-1 line-clamp-2 text-xs leading-5 text-stone-600 sm:mt-2 sm:text-sm sm:leading-6">{item.room.headline}</p>{/if}
							<p class="mt-2 text-xs text-stone-500 sm:mt-3">{m.room_card_capacity({ n: String(item.room.capacity), size: String(item.room.sizeM2) })}</p>
							{#if item.room.amenities.length}
								<div class="mt-2 flex flex-wrap gap-1.5 sm:mt-3">
									{#each item.room.amenities.slice(0, 3) as amenity}<span class="rounded bg-stone-100 px-2 py-1 text-[11px] text-stone-600">{amenity}</span>{/each}
								</div>
							{/if}
						</div>
					</div>
					<div class="min-w-0">
						{#if item.plans.length}
							<div id="plans-{item.room.id}" class="divide-y divide-stone-200">
								{#each item.plans.slice(0, expandedRooms[item.room.id] ? item.plans.length : 2) as option (option.plan.id)}
									<div class="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:p-6">
										<div class="min-w-0">
											<div class="mb-2 flex flex-wrap gap-1.5 text-[11px]">
												{#if option.plan.mealPlan}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{option.plan.mealPlan}</span>{/if}
												{#if option.plan.payment.onsite}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{m.pay_onsite()}</span>{/if}
												{#if option.plan.payment.prepay}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{m.plan_card_payment_card()}</span>{/if}
											</div>
											<h4 class="font-medium leading-6 text-stone-900">{option.plan.name}</h4>
											{#if option.plan.headline && option.plan.headline !== option.plan.name}<p class="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{option.plan.headline}</p>{/if}
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
											<a href={planHref(option.plan.slug, item.room.slug)} class="shrink-0 rounded-md bg-emerald-700 px-4 py-3 text-xs font-semibold text-white hover:bg-emerald-800 sm:bg-brand-800 sm:py-2.5 sm:hover:bg-brand-700">{m.plans_room_details()}</a>
										</div>
									</div>
								{/each}
							</div>
							{#if item.plans.length > 2}
								<div class="border-t border-stone-200 p-4 text-center">
									<button type="button" aria-controls="plans-{item.room.id}" aria-expanded={!!expandedRooms[item.room.id]} onclick={() => (expandedRooms[item.room.id] = !expandedRooms[item.room.id])} class="w-full rounded-md border border-stone-300 px-5 py-2.5 text-sm font-semibold text-brand-800 hover:border-brand-800 hover:bg-brand-50 sm:w-auto">
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
</div>
