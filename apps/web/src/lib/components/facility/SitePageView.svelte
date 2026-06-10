<script lang="ts">
	// 下層コンテンツページの共通ビュー（テンプレート別の体裁で描画・スマホ最適化・スクロールリビール）
	import type { SitePage } from '$lib/types';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import { reveal } from '$lib/actions/reveal';

	let {
		page,
		variant
	}: { page: SitePage; variant: 'yamado' | 'oga' | 'standard' } = $props();
</script>

<!-- ヒーロー（原サイト同様: 大判写真 + 英字/和字タイトル） -->
<section class="relative overflow-hidden">
	<img src={page.heroUrl} alt={page.title} class="hero-zoom h-[42vh] min-h-[260px] w-full object-cover sm:h-[52vh]" />
	<div class="absolute inset-0 {variant === 'oga' ? 'bg-black/30' : 'bg-gradient-to-b from-black/10 to-black/45'}"></div>
	<div class="absolute inset-0 flex flex-col items-center justify-center text-center text-white">
		{#if variant === 'oga'}
			<h1 class="font-cormorant text-3xl font-light tracking-[0.4em] sm:text-5xl">{page.titleEn}</h1>
			<p class="mt-4 text-lg tracking-[0.4em]">{page.title}</p>
		{:else}
			<h1 class="text-3xl tracking-[0.3em] sm:text-4xl">{page.title}</h1>
			<p class="mt-3 text-sm tracking-[0.5em] opacity-80">{page.titleEn.toUpperCase()}</p>
		{/if}
	</div>
</section>

<div class="mx-auto {variant === 'yamado' ? 'max-w-[980px]' : 'max-w-6xl'} px-4 py-12 sm:py-16">
	<!-- リード文 -->
	{#if page.lead}
		<p
			use:reveal
			class="mx-auto max-w-[640px] text-center text-[17px] {variant === 'oga' ? 'leading-[2.2]' : 'leading-[2]'} tracking-wider"
		>
			{page.lead}
		</p>
	{/if}

	<!-- セクション（左右交互の大判写真 + 見出し/本文・スマホは縦積み） -->
	<div class="mt-12 space-y-16 sm:mt-20 sm:space-y-24">
		{#each page.sections as section, i}
			<section use:reveal class="grid items-center gap-6 sm:gap-10 {section.imageUrl ? 'md:grid-cols-2' : ''} {i % 2 === 1 && section.imageUrl ? 'md:[&>*:first-child]:order-2' : ''}">
				{#if section.imageUrl}
					<div class="overflow-hidden">
						<img
							src={section.imageUrl}
							alt={section.heading}
							class="h-64 w-full object-cover transition duration-1000 hover:scale-105 sm:h-80"
							loading="lazy"
						/>
					</div>
				{/if}
				<div class="{section.imageUrl ? 'md:px-6' : 'mx-auto max-w-[640px] text-center'}">
					{#if section.headingEn}
						<p class="{variant === 'oga' ? 'font-cormorant' : ''} text-xs font-semibold tracking-[0.45em] text-stone-400">
							{section.headingEn.toUpperCase()}
						</p>
					{/if}
					<h2 class="mt-3 text-xl leading-relaxed tracking-wider sm:text-2xl" style="color: var(--fac-heading, #1f1d15)">
						{section.heading}
					</h2>
					<div class="mt-5 text-[17px] leading-[2]">
						<MarkdownView source={section.body} />
					</div>
					{#if section.note}
						<p class="mt-4 inline-block border border-stone-200 bg-stone-50 px-4 py-2 text-[14px] tracking-wide text-stone-600">
							{section.note}
						</p>
					{/if}
				</div>
			</section>
		{/each}
	</div>
</div>
