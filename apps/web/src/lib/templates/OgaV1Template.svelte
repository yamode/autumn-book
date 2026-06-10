<script lang="ts">
	// 男鹿「山人 -oga-」専用テンプレート（現行 oga.yamado.co.jp のミニマルモダンデザインを再現）
	// トーン: サンセリフ・白/黒/グレー・大判写真・英字見出し（NATURE/CUISINE/STAY）
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

	// 3本柱: NATURE（景色）/ CUISINE（料理）/ STAY（客室）
	let pillars = $derived(
		[
			{ key: 'NATURE', photo: f.photos.find((p) => p.category === 'view') },
			{ key: 'CUISINE', photo: f.photos.find((p) => p.category === 'meal') },
			{ key: 'STAY', photo: f.photos.find((p) => p.category === 'room') }
		].filter((p) => p.photo !== undefined)
	);
</script>

<div class="oga-v1 bg-white" style="--fac-heading: #1c1c1c; --fac-accent: #555;">
	<!-- ヒーロー: フルブリード + 大きなキャッチ -->
	<section class="relative">
		<img src={f.photos[0].url} alt={f.name} class="h-[520px] w-full object-cover sm:h-[600px]" />
		<div class="absolute inset-0 bg-black/25"></div>
		<div class="absolute inset-0 flex flex-col items-center justify-center text-center text-white">
			<p class="font-cormorant text-xs tracking-[0.6em] opacity-80">OGA PENINSULA, AKITA</p>
			<h1 class="font-cormorant mt-4 text-3xl font-light tracking-[0.4em] sm:text-5xl">{f.name}</h1>
			<p class="mt-6 text-base tracking-[0.5em] sm:text-lg">{f.catchCopy}</p>
			<a href="{base}/plans" class="mt-10 border border-white/80 px-10 py-3 text-xs tracking-[0.3em] transition hover:bg-white hover:text-stone-900">
				RESERVATION
			</a>
		</div>
		<div class="absolute bottom-4 left-1/2 -translate-x-1/2 animate-bounce text-white/70">↓</div>
	</section>

	<div class="mx-auto max-w-6xl space-y-24 px-4 py-20">
		<NewsSection news={data.news} {base} variant="oga" />

		<!-- コンセプト -->
		<section class="mx-auto max-w-[600px] text-center">
			<h2 class="text-xl font-light leading-loose tracking-[0.3em]" style="color: var(--fac-heading)">{f.catchCopy}</h2>
			<p class="mt-8 text-[16px] leading-[1.75] tracking-[0.05em] text-stone-600">{f.description}</p>
		</section>

		<!-- 3本柱: NATURE / CUISINE / STAY（左右交互の大判写真） -->
		{#each pillars as pillar, i}
			<section id={pillar.key.toLowerCase()} class="grid items-center gap-8 md:grid-cols-2 {i % 2 === 1 ? 'md:[&>*:first-child]:order-2' : ''}">
				<div class="overflow-hidden">
					<img src={pillar.photo!.url} alt={pillar.photo!.caption} class="h-80 w-full object-cover transition duration-700 hover:scale-105" loading="lazy" />
				</div>
				<div class="px-2 md:px-8">
					<h2 class="font-cormorant text-sm font-semibold tracking-[0.5em] text-stone-400">{pillar.key}</h2>
					<p class="mt-6 text-lg font-light leading-loose tracking-wider" style="color: var(--fac-heading)">{pillar.photo!.caption}</p>
					{#if pillar.key === 'STAY'}
						<a href="{base}/rooms/{data.rooms[0]?.slug}" class="mt-6 inline-block text-xs tracking-[0.3em] text-stone-500 underline-offset-8 hover:underline">VIEW ROOMS →</a>
					{:else if pillar.key === 'CUISINE'}
						<a href="{base}/plans" class="mt-6 inline-block text-xs tracking-[0.3em] text-stone-500 underline-offset-8 hover:underline">VIEW PLANS →</a>
					{/if}
				</div>
			</section>
		{/each}

		<!-- ABOUT グリッド（客室3タイプ + 予約導線） -->
		<section id="rooms">
			<h2 class="font-cormorant mb-8 text-center text-sm font-semibold tracking-[0.5em] text-stone-400">ABOUT</h2>
			<div class="grid gap-px bg-stone-200 sm:grid-cols-3">
				{#each data.rooms as room}
					<a href="{base}/rooms/{room.slug}" class="group relative block bg-white">
						<img src={room.photos[0]?.url} alt={room.name} class="h-52 w-full object-cover opacity-90 transition group-hover:opacity-100" loading="lazy" />
						<div class="p-4">
							<p class="text-sm tracking-widest" style="color: var(--fac-heading)">{room.name}</p>
							<p class="mt-1 text-xs text-stone-400">{m.room_card_capacity({ n: String(room.capacity), size: String(room.sizeM2) })}</p>
						</div>
					</a>
				{/each}
			</div>
		</section>

		<!-- プラン -->
		<section>
			<h2 class="font-cormorant mb-8 text-center text-sm font-semibold tracking-[0.5em] text-stone-400">PLAN</h2>
			<div class="space-y-4">
				{#each data.plans.slice(0, 3) as plan}
					<PlanCard {plan} href="{base}/plans/{plan.slug}" />
				{/each}
			</div>
			<p class="mt-4 text-center">
				<a href="{base}/plans" class="text-xs tracking-[0.3em] text-stone-500 underline-offset-8 hover:underline">{m.facility_all_plans()} →</a>
			</p>
		</section>

		<CalendarSection calendar={data.calendar} calMonth={data.calMonth} {base} />
		<AccessSection {f} />
		<FaqSection faqs={data.facilityFaqs} />
		<OverviewSection {f} />
	</div>
</div>

