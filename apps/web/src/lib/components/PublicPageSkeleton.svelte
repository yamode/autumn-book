<script lang="ts">
	// A面（公式の予約システム）: ページを移る間に、本文の位置へ出す「読み込み中」の枠（2026-11-02 指示
	// 「まずページを切り替え、それから各要素をシマーから徐々に表示」）。B面の PartnerPageSkeleton と同じ考え方で、
	// 行き先のページの形（見出し・写真・カード・右欄）だけをまねた軽いもの。中身は行き先のページが届いてから。
	// 出し入れは routes/(public)/+layout.svelte（120ms 待ってから出す）。
	import * as m from '$lib/paraglide/messages';

	let { kind }: { kind: 'plans' | 'plan' | 'rooms' | 'room' | 'page' } = $props();
</script>

<div class="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10" aria-busy="true">
	<p class="sr-only" role="status">{m.common_loading()}</p>
	<div class="shimmer h-3 w-56 opacity-70"></div>
	{#if kind === 'plan'}
		<!-- プラン詳細: 左＝見出し・写真・本文、右＝料金の枠 -->
		<div class="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_320px] md:gap-x-8">
			<div class="space-y-4">
				<div class="shimmer h-5 w-24 rounded-full"></div>
				<div class="shimmer h-8 w-4/5"></div>
				<div class="shimmer-block aspect-[16/10] w-full rounded-xl" aria-hidden="true"></div>
				<div class="space-y-2.5 pt-2">{#each [0, 1, 2, 3] as i (i)}<div class="shimmer h-4 {i === 3 ? 'w-2/3' : 'w-full'} opacity-70"></div>{/each}</div>
			</div>
			<div class="hidden rounded-xl border border-stone-200 bg-white p-4 md:block">
				<div class="space-y-2.5">{#each [0, 1] as i (i)}<div class="shimmer h-4 w-3/4 opacity-70"></div>{/each}</div>
				<div class="shimmer-block mt-4 h-20 w-full" aria-hidden="true"></div>
				<div class="shimmer mt-4 h-8 w-1/2"></div>
				<div class="shimmer mt-4 h-11 w-full"></div>
			</div>
		</div>
	{:else if kind === 'plans' || kind === 'rooms'}
		<!-- 一覧: 見出し → 切り替え・検索 → カード -->
		<div class="shimmer mt-4 h-8 w-64"></div>
		<div class="shimmer mt-5 h-14 w-full rounded-full"></div>
		<div class="mt-6 space-y-5">
			{#each [0, 1, 2] as i (i)}
				<div class="grid gap-4 rounded-xl border border-stone-200 bg-white p-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:p-6">
					<div class="shimmer-block aspect-[3/2] w-full rounded-lg" aria-hidden="true"></div>
					<div class="space-y-3">
						<div class="shimmer h-6 w-3/4"></div>
						<div class="shimmer h-4 w-1/2 opacity-70"></div>
						<div class="shimmer h-4 w-full opacity-70"></div>
						<div class="shimmer ml-auto mt-6 h-10 w-40"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if kind === 'room'}
		<!-- 客室詳細: 見出し → 写真と説明 -->
		<div class="shimmer mt-4 h-8 w-1/2"></div>
		<div class="mt-5 grid gap-5 rounded-xl border border-stone-200 bg-white p-4 sm:p-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
			<div class="shimmer-block aspect-[3/2] w-full rounded-lg" aria-hidden="true"></div>
			<div class="space-y-3">{#each [0, 1, 2, 3] as i (i)}<div class="shimmer h-4 {i === 3 ? 'w-1/2' : 'w-full'} opacity-70"></div>{/each}</div>
		</div>
	{:else}
		<!-- そのほかのページ: 見出しと本文の段 -->
		<div class="shimmer mt-4 h-8 w-1/2"></div>
		<div class="mt-6 space-y-4">
			{#each [0, 1, 2] as i (i)}
				<div class="rounded-xl border border-stone-200 bg-white p-5">
					<div class="shimmer h-5 w-1/3"></div>
					<div class="mt-3 space-y-2">{#each [0, 1] as j (j)}<div class="shimmer h-4 w-full opacity-70"></div>{/each}</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
