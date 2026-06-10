<script lang="ts">
	// 西和賀「山人 -yamado-」専用テンプレート（現行 www.yamado.co.jp の和モダンデザインを再現）
	// トーン: 明朝体・白/黒/深緑・余白で高級感・縦書きアクセント
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

	// 「山人に来る理由」: 写真カテゴリ駆動（温泉・料理・景色）
	let reasons = $derived(
		(['bath', 'meal', 'view'] as const)
			.map((c) => f.photos.find((p) => p.category === c))
			.filter((p) => p !== undefined)
	);
</script>

<div class="yamado-v1 bg-[#faf9f6]" style="--fac-heading: #2e3a2f; --fac-accent: #4a6b52;">
	<!-- ヒーロー: 縦書きキャッチ -->
	<section class="relative">
		<img src={f.photos[0].url} alt={f.name} class="h-[480px] w-full object-cover sm:h-[560px]" />
		<div class="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/50"></div>
		<p
			class="absolute right-6 top-10 hidden text-2xl leading-loose tracking-[0.4em] text-white drop-shadow-md [writing-mode:vertical-rl] sm:block"
			style="font-family: 'Yu Mincho', serif;"
		>
			{f.catchCopy}
		</p>
		<div class="absolute inset-x-0 bottom-0 mx-auto max-w-5xl px-4 pb-10 text-white">
			<p class="text-xs tracking-[0.3em] opacity-80">{f.prefecture}・西和賀</p>
			<h1 class="mt-1 text-3xl tracking-[0.25em] sm:text-4xl" style="font-family: 'Yu Mincho', serif;">{f.name}</h1>
			<a href="{base}/plans" class="mt-5 inline-block border border-white/70 px-8 py-2.5 text-sm tracking-widest transition hover:bg-white hover:text-stone-900">
				{m.facility_see_plans()}
			</a>
		</div>
	</section>

	<div class="mx-auto max-w-5xl space-y-20 px-4 py-16">
		<NewsSection news={data.news} {base} variant="yamado" />

		<!-- コンセプト -->
		<section class="mx-auto max-w-2xl text-center">
			<p class="mb-3 text-xs tracking-[0.5em]" style="color: var(--fac-accent)">CONCEPT</p>
			<h2 class="mb-6 text-2xl leading-relaxed tracking-[0.2em]" style="font-family: 'Yu Mincho', serif; color: var(--fac-heading)">
				{f.catchCopy}
			</h2>
			<p class="text-sm leading-[2.2] tracking-wider text-stone-600">{f.description}</p>
		</section>

		<!-- 山人に来る理由（温泉・料理・景色） -->
		{#if reasons.length > 0}
			<section>
				<p class="mb-2 text-center text-xs tracking-[0.5em]" style="color: var(--fac-accent)">REASON</p>
				<h2 class="mb-8 text-center text-2xl tracking-[0.2em]" style="font-family: 'Yu Mincho', serif; color: var(--fac-heading)">
					{m.tmpl_reasons_title()}
				</h2>
				<div class="grid gap-6 sm:grid-cols-3">
					{#each reasons as photo, i}
						<figure class="group">
							<div class="overflow-hidden">
								<img src={photo.url} alt={photo.caption} class="h-56 w-full object-cover transition duration-700 group-hover:scale-105" loading="lazy" />
							</div>
							<figcaption class="mt-3 flex items-start gap-3">
								<span class="text-3xl font-light" style="font-family: 'Yu Mincho', serif; color: var(--fac-accent)">{String(i + 1).padStart(2, '0')}</span>
								<span class="pt-1.5 text-sm leading-relaxed tracking-wider text-stone-700">{photo.caption}</span>
							</figcaption>
						</figure>
					{/each}
				</div>
			</section>
		{/if}

		<!-- 客室 -->
		<section>
			<p class="mb-2 text-center text-xs tracking-[0.5em]" style="color: var(--fac-accent)">GUEST ROOM</p>
			<h2 class="mb-8 text-center text-2xl tracking-[0.2em]" style="font-family: 'Yu Mincho', serif; color: var(--fac-heading)">
				{m.facility_rooms()}
			</h2>
			<div class="grid gap-6 sm:grid-cols-3">
				{#each data.rooms as room}
					<RoomCard {room} href="{base}/rooms/{room.slug}" />
				{/each}
			</div>
		</section>

		<!-- プラン -->
		<section>
			<div class="mb-8 text-center">
				<p class="mb-2 text-xs tracking-[0.5em]" style="color: var(--fac-accent)">PLAN</p>
				<h2 class="text-2xl tracking-[0.2em]" style="font-family: 'Yu Mincho', serif; color: var(--fac-heading)">{m.facility_recommend_plans()}</h2>
			</div>
			<div class="space-y-4">
				{#each data.plans.slice(0, 3) as plan}
					<PlanCard {plan} href="{base}/plans/{plan.slug}" />
				{/each}
			</div>
			<p class="mt-4 text-center">
				<a href="{base}/plans" class="text-sm tracking-widest underline-offset-4 hover:underline" style="color: var(--fac-accent)">{m.facility_all_plans()}</a>
			</p>
		</section>

		<CalendarSection calendar={data.calendar} calMonth={data.calMonth} {base} />
		<AccessSection {f} />
		<FaqSection faqs={data.facilityFaqs} />
		<OverviewSection {f} />
	</div>
</div>

<style>
	.yamado-v1 {
		font-family: 'Yu Mincho', 'Hiragino Mincho ProN', serif;
	}
</style>
