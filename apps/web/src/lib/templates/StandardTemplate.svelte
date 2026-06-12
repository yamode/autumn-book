<script lang="ts">
	// 標準テンプレート（新ブランド・新施設の既定。従来の施設HPレイアウト）
	import PhotoGallery from '$lib/components/PhotoGallery.svelte';
	import RoomCard from '$lib/components/RoomCard.svelte';
	import PlanCard from '$lib/components/PlanCard.svelte';
	import NewsSection from '$lib/components/facility/NewsSection.svelte';
	import CalendarSection from '$lib/components/facility/CalendarSection.svelte';
	import AccessSection from '$lib/components/facility/AccessSection.svelte';
	import FaqSection from '$lib/components/facility/FaqSection.svelte';
	import OverviewSection from '$lib/components/facility/OverviewSection.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { FacilityPageData } from './types';

	let { data }: { data: FacilityPageData } = $props();
	let f = $derived(data.facility);
	let base = $derived(`/${f.brandSlug}/${f.slug}`);
</script>

<!-- ヒーロー -->
<section class="relative">
	<img src={f.photos[0].url} alt={f.name} class="h-[400px] w-full object-cover sm:h-[460px]" />
	<div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
	<div class="absolute inset-x-0 bottom-0 mx-auto max-w-6xl px-4 pb-8 text-white">
		<p class="text-sm opacity-90">{f.prefecture}</p>
		<h1 class="font-display text-3xl sm:text-4xl">{f.name}</h1>
		<p class="mt-2 text-sm opacity-90">{f.catchCopy}</p>
		<a href="{base}/plans" class="mt-4 inline-block rounded-lg bg-accent-600 px-6 py-2.5 text-sm font-medium hover:bg-accent-500">{m.facility_see_plans()}</a>
	</div>
</section>

<div class="mx-auto max-w-6xl space-y-14 px-4 py-12">
	<NewsSection news={data.news} {base} />

	<!-- コンセプト -->
	<section class="mx-auto max-w-3xl text-center">
		<h2 class="font-display mb-4 text-2xl text-brand-900">{f.catchCopy}</h2>
		<p class="text-sm leading-loose text-stone-600">{f.description}</p>
	</section>

	<!-- ギャラリー -->
	<section>
		<h2 class="font-display mb-4 text-2xl text-brand-900">{m.facility_gallery()}</h2>
		<PhotoGallery photos={f.photos} />
	</section>

	<!-- 客室 -->
	<section>
		<h2 class="font-display mb-4 text-2xl text-brand-900">{m.facility_rooms()}</h2>
		<div class="grid gap-5 sm:grid-cols-2">
			{#each data.rooms as room}
				<RoomCard {room} href="{base}/rooms/{room.slug}" />
			{/each}
		</div>
	</section>

	<!-- おすすめプラン -->
	<section>
		<div class="mb-4 flex items-end justify-between">
			<h2 class="font-display text-2xl text-brand-900">{m.facility_recommend_plans()}</h2>
			<a href="{base}/plans" class="text-sm text-accent-600 hover:underline">{m.facility_all_plans()}</a>
		</div>
		<div class="space-y-4">
			{#each data.plans.slice(0, 3) as plan}
				<PlanCard {plan} href="{base}/plans/{plan.slug}" />
			{/each}
		</div>
	</section>

	<CalendarSection calendar={data.calendar} calMonth={data.calMonth} calendarNav={data.calendarNav} {base} />
	<AccessSection {f} />
	<FaqSection faqs={data.facilityFaqs} />
	<OverviewSection {f} />
</div>
