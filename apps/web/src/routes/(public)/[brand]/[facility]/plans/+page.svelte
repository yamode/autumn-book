<script lang="ts">
	import { page } from '$app/state';
	import FacilityGallery from '$lib/components/FacilityGallery.svelte';
	import FacilityAvailabilityCalendar from '$lib/components/FacilityAvailabilityCalendar.svelte';
	import { searchQuery } from '$lib/components/guests';
	import { facilityThumbnailUrl } from '$lib/facility-thumbnail';
	import { formatPrice } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let base = $derived(`/${data.facility.brandSlug}/${data.facility.slug}`);
	let facilitiesHref = $derived(data.params.checkin ? `/search?${searchQuery(data.params)}` : '/search');
	let expandedRooms = $state<Record<string, boolean>>({});

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
			{#if data.facility.catchCopy}
				<h2 class="font-display mt-7 text-xl leading-snug text-brand-900">{data.facility.catchCopy}</h2>
			{/if}
			{#if data.facility.description}
				<p class="mt-3 line-clamp-4 text-sm leading-7 text-stone-600">{data.facility.description}</p>
			{/if}
			<div class="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-y border-stone-200 py-3 text-xs text-stone-600">
				<span>IN {data.facility.checkinTime}</span>
				<span>OUT {data.facility.checkoutTime}</span>
				{#each data.facility.amenities.slice(0, 3) as amenity}
					<span>{amenity}</span>
				{/each}
			</div>
			<div class="mt-6">
				<h2 class="font-display mb-3 text-lg text-brand-900">{m.facility_gallery()}</h2>
				<FacilityGallery photos={data.facility.photos} cover={facilityThumbnailUrl(data.facility.slug, data.facility.photos[0]?.url ?? '')} name={data.facility.name} />
			</div>
		</div>
		<div class="lg:sticky lg:top-28">
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

	<section id="rooms" class="mt-14 scroll-mt-28 border-t border-stone-200 pt-8 sm:mt-20">
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div>
				<p class="text-xs font-semibold tracking-[0.22em] text-stone-500">ROOMS & PLANS</p>
				<h2 class="font-display mt-2 text-2xl text-brand-900 sm:text-3xl">{m.plans_heading()}</h2>
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
			<div class="mt-5 flex flex-wrap gap-2">
				{#each data.allTags as tag}
					<a href={tagHref(tag)} class="rounded-full border px-3 py-1 text-xs transition {data.params.tag === tag ? 'border-brand-800 bg-brand-800 text-white' : 'border-stone-300 text-stone-600 hover:border-brand-800 hover:text-brand-800'}">{tag}</a>
				{/each}
			</div>
		{/if}

		<div class="mt-7 space-y-6">
			{#each data.rooms as item (item.room.id)}
				<article class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm lg:grid lg:grid-cols-[290px_minmax(0,1fr)]">
					<div class="border-b border-stone-200 lg:border-b-0 lg:border-r">
						<img src={roomPhoto(item.room)} alt={item.room.name} class="aspect-[16/10] w-full object-cover" loading="lazy" />
						<div class="p-5">
							<h3 class="font-display text-xl leading-snug text-brand-900">{item.room.name}</h3>
							{#if item.room.headline}<p class="mt-2 text-sm leading-6 text-stone-600">{item.room.headline}</p>{/if}
							<p class="mt-3 text-xs text-stone-500">{m.room_card_capacity({ n: String(item.room.capacity), size: String(item.room.sizeM2) })}</p>
							{#if item.room.amenities.length}
								<div class="mt-3 flex flex-wrap gap-1.5">
									{#each item.room.amenities.slice(0, 3) as amenity}<span class="rounded bg-stone-100 px-2 py-1 text-[11px] text-stone-600">{amenity}</span>{/each}
								</div>
							{/if}
						</div>
					</div>
					<div class="min-w-0">
						{#if item.plans.length}
							<div id="plans-{item.room.id}" class="divide-y divide-stone-200">
								{#each item.plans.slice(0, expandedRooms[item.room.id] ? item.plans.length : 2) as option (option.plan.id)}
									<div class="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-6">
										<div class="min-w-0">
											<div class="mb-2 flex flex-wrap gap-1.5 text-[11px]">
												{#if option.plan.mealPlan}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{option.plan.mealPlan}</span>{/if}
												{#if option.plan.payment.onsite}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{m.pay_onsite()}</span>{/if}
												{#if option.plan.payment.prepay}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{m.plan_card_payment_card()}</span>{/if}
											</div>
											<h4 class="font-medium leading-6 text-stone-900">{option.plan.name}</h4>
											{#if option.plan.headline && option.plan.headline !== option.plan.name}<p class="mt-1 line-clamp-2 text-xs leading-5 text-stone-500">{option.plan.headline}</p>{/if}
										</div>
										<div class="flex items-end justify-between gap-3 sm:flex-col sm:items-end">
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
											<a href={planHref(option.plan.slug, item.room.slug)} class="shrink-0 rounded-md bg-brand-800 px-4 py-2.5 text-xs font-semibold text-white hover:bg-brand-700">{m.plans_room_details()}</a>
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
