<script lang="ts">
	// 同じページのまま検索条件だけ変えたとき（日付・人数・絞り込み）、検索バーや見出しはそのまま残し、
	// 結果の欄だけを読み込み表示（シマー）にする（2026-11-18 指示「日付ピッカーごと表示しなおすのではなく、検索結果のエリアだけを再表示」）。
	// 古い結果はすっと薄くし、読み込みが 140ms を超えたときだけシマーを重ねる（すぐ終わるときはチラつかせない）。
	// 新しい結果はふわっと出る。data-results があるページは、PageLoadingBoundary の「全体を薄くする」対象から外れる。
	import type { Snippet } from 'svelte';
	import { refreshingSamePage, type LoadingShape } from '$lib/page-transition';
	import PageLoadingSkeleton from './PageLoadingSkeleton.svelte';

	let { shape, children }: { shape: Extract<LoadingShape, 'search-results' | 'plans-results'>; children: Snippet } = $props();
	const refreshing = $derived(refreshingSamePage());
</script>

<div data-results class="relative" aria-busy={refreshing || undefined} style:min-height={refreshing ? '24rem' : undefined}>
	<div class="transition-opacity duration-200 ease-out {refreshing ? 'opacity-0' : 'opacity-100'}" inert={refreshing}>
		{@render children()}
	</div>
	{#if refreshing}
		<div class="results-shimmer absolute inset-x-0 top-0"><PageLoadingSkeleton {shape} /></div>
	{/if}
</div>

<style>
	.results-shimmer {
		animation: results-fade 200ms ease-out 140ms both;
	}
	@keyframes results-fade {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	@media (prefers-reduced-motion: reduce) {
		.results-shimmer { animation: none; }
	}
</style>
