<script lang="ts">
	// 客室一覧（施設 → 客室一覧 → 客室詳細の動線・2026-11-02 指示「取引先ページの客室ページの UI と共通化」）。
	// 取引先ページの「お部屋のご紹介」（/p/[token]/rooms）と同じ作り: 部屋の名前のチップ → 部屋ごとの枠
	// （写真のギャラリー＋説明・仕様・設備＋「浴室・アメニティ・設備」を開いて詳しい紹介）。枠の右下からその部屋のページ（プラン）へ。
	import PartnerContentBody from '$lib/components/PartnerContentBody.svelte';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let f = $derived(data.facility);
	let base = $derived(`/${f.brandSlug}/${f.slug}`);
	const anchor = (slug: string) => `room-${slug}`;
</script>

<svelte:head><title>{m.facility_rooms()} ｜ {f.name}</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10" style="--pt-accent: var(--color-brand-800); --pt-accent-soft: var(--color-stone-100)">
	<nav class="mb-4 text-xs text-stone-500" aria-label="breadcrumb">
		<a href="/search" class="hover:underline">{m.common_facility_list()}</a> /
		<a href="{base}/plans" class="hover:underline">{m.plans_breadcrumb()}</a> / {m.rooms_list_title()}
	</nav>
	<h1 class="font-display text-2xl text-brand-900 sm:text-3xl">{f.name}</h1>
	<!-- プラン一覧と同じ切り替え（プランから探す／お部屋から探す） -->
	<nav class="mt-4 flex gap-2 border-b border-stone-200 text-sm" aria-label={m.plans_view_switch()}>
		<a href="{base}/plans" class="-mb-px border-b-2 border-transparent px-3 py-2 text-stone-500 hover:text-brand-900">{m.plans_tab_plans()}</a>
		<span class="-mb-px border-b-2 border-brand-800 px-3 py-2 font-medium text-brand-900" aria-current="page">{m.plans_tab_rooms()}</span>
	</nav>

	{#if data.rooms.length === 0}
		<p class="mt-8 rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500">{m.rooms_list_empty()}</p>
	{:else}
		<nav class="mt-5 flex flex-wrap gap-1.5 text-sm" aria-label={m.rooms_list_title()}>
			{#each data.rooms as r (r.slug)}
				<a href="#{anchor(r.slug)}" class="rounded-full border border-stone-300 bg-white px-3 py-1 hover:border-brand-900">{r.name}</a>
			{/each}
		</nav>

		<div class="mt-6 space-y-8">
			{#each data.rooms as r (r.slug)}
				<article id={anchor(r.slug)} class="scroll-mt-28 rounded-xl border border-stone-200 bg-white p-4 sm:p-6">
					<header class="mb-4">
						<h2 class="text-xl font-bold leading-snug text-brand-900"><a href="{base}/rooms/{r.slug}" class="hover:underline">{r.name}</a></h2>
						<p class="mt-1 text-sm text-stone-500">{#if r.headline && r.headline !== r.name}{r.headline}・{/if}{m.room_detail_capacity({ n: String(r.capacity), size: String(r.sizeM2) })}</p>
					</header>
					<PartnerContentBody photos={r.photos} description={r.description} specs={r.specs} sections={r.sections} amenities={r.amenities} detailLabel={m.room_detail_more()}>
						{#snippet actions()}
							<a href="{base}/rooms/{r.slug}" class="flex w-full items-center justify-center gap-2 rounded-lg bg-accent-600 px-5 py-3 text-base font-bold text-white hover:bg-accent-500">{m.rooms_view_plans()}</a>
						{/snippet}
					</PartnerContentBody>
				</article>
			{/each}
		</div>
	{/if}
</div>
