<script lang="ts">
	import PlanCard from '$lib/components/PlanCard.svelte';
	// 客室詳細（施設 → 客室一覧 → 客室詳細）。紹介は取引先ページのお部屋の紹介と同じ部品（2026-11-02）
	import PartnerContentBody from '$lib/components/PartnerContentBody.svelte';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let base = $derived(`/${data.facility.brandSlug}/${data.facility.slug}`);
</script>

<svelte:head>
	<title>{m.room_detail_title({ name: data.room.name, facility: data.facility.name })}</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10" style="--pt-accent: var(--color-brand-800); --pt-accent-soft: var(--color-stone-100)">
	<nav class="mb-4 text-xs text-stone-500" aria-label="breadcrumb">
		<a href="/search" class="hover:underline">{m.common_facility_list()}</a> /
		<a href="{base}/plans" class="hover:underline">{m.plans_breadcrumb()}</a> /
		<a href="{base}/rooms" class="hover:underline">{m.rooms_list_title()}</a> / {data.room.name}
	</nav>

	<header class="mb-4">
		<p class="text-xs tracking-wider text-stone-500">{data.facility.name}</p>
		<h1 class="font-display text-2xl leading-snug text-brand-900 sm:text-3xl">{data.room.name}</h1>
		<p class="mt-1 text-sm text-stone-500">{#if data.room.headline && data.room.headline !== data.room.name}{data.room.headline}・{/if}{m.room_detail_capacity({ n: String(data.room.capacity), size: String(data.room.sizeM2) })}</p>
	</header>
	<div class="rounded-xl border border-stone-200 bg-white p-4 sm:p-6">
		<PartnerContentBody photos={data.room.photos} description={data.room.description} specs={data.room.specs} sections={data.room.sections} amenities={data.room.amenities} detailLabel={m.room_detail_more()} />
	</div>

	<section class="mt-10">
		<h2 class="font-display mb-4 text-xl text-brand-900">{m.room_detail_plans()}</h2>
		<div class="space-y-4">
			{#each data.plans as plan}
				<!-- この客室を選んだ状態でプラン詳細を開く（room= が無いと客室が未選択のまま開いていた・2026-11-01） -->
				<PlanCard {plan} href="{base}/plans/{plan.slug}?room={encodeURIComponent(data.room.slug)}" />
			{:else}
				<p class="text-sm text-stone-500">{m.room_detail_no_plans()}</p>
			{/each}
		</div>
	</section>
</div>
