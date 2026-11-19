<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { pendingPage, refreshingSamePage, transitionTitle, loadingShape } from '$lib/page-transition';
	import PageLoadingSkeleton from './PageLoadingSkeleton.svelte';

	let {
		shell, children, title, placeholder, padding = 'px-4 py-5 sm:px-6'
	}: {
		shell: Parameters<typeof pendingPage>[0];
		children: Snippet;
		title?: string;
		placeholder?: Snippet;
		padding?: string;
	} = $props();
	const pending = $derived(pendingPage(shell));
	const shape = $derived(loadingShape(pending?.route.id ?? ''));
	const homePending = $derived(pending?.route.id === '/(public)');
	// This flag applies only to the first HTML render. CSS also reveals the page if hydration is delayed.
	// svelte-ignore state_referenced_locally
	let initialHome = $state(shell === 'root' && page.route.id === '/(public)');
	// 同じページのまま条件だけ変えているとき（全体の骨組みは出さない）。結果の欄を持たないページは中身を少し薄くして読み込み中を知らせる
	const refreshing = $derived(!pending && refreshingSamePage());

	// 画面の切り替えはフェードでつなぐ（2026-11-18 指示「パッパッと切り替わって疲れる」）。
	// 出ていく画面は CSS（.page-leaving）で薄くし、読み込みが少しかかるときだけシマーが浮かぶ（.transition-layer の遅延）。
	// 新しい画面が入ったら、その中身をふわっと出す（中身の枠は display: contents なので子要素ごとに）。
	let content = $state<HTMLElement>();
	let wasPending = false;
	function fadeContent() {
		if (!content || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		for (const el of content.children) {
			(el as HTMLElement).animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' });
		}
	}
	onMount(() => {
		if (!initialHome) return;
		initialHome = false;
		fadeContent();
	});
	$effect(() => {
		const now = Boolean(pending);
		if (wasPending && !now) fadeContent();
		wasPending = now;
	});
</script>

{#snippet homeLoader(initial: boolean)}
	<div class="home-loading" class:initial role="status">
		<img src="/brand/yamado-brush-mark.png" width="256" height="122" alt="" fetchpriority="high" />
		<span class="home-spinner" aria-hidden="true"></span>
		<span class="sr-only">{m.common_loading()}</span>
	</div>
{/snippet}

{#if initialHome}{@render homeLoader(true)}{/if}
<div class={pending ? 'transition-frame' : 'contents'} data-refreshing={refreshing || undefined}>
	<!-- Keep the outgoing page mounted and preserve its size until the router records scroll and commits. -->
	<div bind:this={content} data-transition-content class={pending ? 'page-leaving' : 'contents'} inert={Boolean(pending)} aria-hidden={pending ? 'true' : undefined}>
		{@render children()}
	</div>
	{#if homePending}
		{@render homeLoader(false)}
	{:else if pending}
		<div class="transition-layer" data-transition-shell={shell} data-transition-route={pending.route.id}>
			<div class="transition-viewport {padding}">
				{#if placeholder}
					{@render placeholder()}
				{:else}
					{#if shell === 'root'}
						<div class="mx-auto mb-6 max-w-6xl border-b border-stone-200 pb-4 font-display text-lg text-stone-900">YAMADO Book</div>
					{/if}
					<div class={shell === 'root' || shell === 'public' ? 'mx-auto max-w-6xl' : ''}>
						<PageLoadingSkeleton {shape} title={title ?? transitionTitle(pending.route.id ?? '')} />
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.home-loading {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
		background: white;
		animation: page-fade 140ms ease-out 140ms both;
	}
	.home-loading.initial { animation: home-loader-exit 180ms ease-out 1.5s both; }
	.home-loading img { width: 7rem; height: auto; }
	.home-spinner {
		position: absolute;
		top: calc(50% + 2.4rem);
		width: 1.2rem;
		height: 1.2rem;
		border: 2px solid #e7e5e4;
		border-top-color: #476550;
		border-radius: 50%;
		animation: home-spin 800ms linear infinite;
	}
	@keyframes home-spin { to { transform: rotate(1turn); } }
	@keyframes home-loader-exit { to { opacity: 0; visibility: hidden; } }
	.transition-frame {
		position: relative;
		display: flow-root;
		min-block-size: min(33rem, 82svh);
	}
	.transition-layer {
		position: absolute;
		inset: 0;
		/* 骨組みは出ていく画面の大きさの枠に重ねる。行き先の骨組みのほうが背が高いとフッターに重なるので、枠の外は切り取り、
		   下端は薄くぼかして切れ目を見せない（2026-11-19 指示）。clip は hidden と違ってスクロールの枠を作らず、中の sticky が効いたまま */
		overflow: clip;
		mask-image: linear-gradient(to bottom, #000 calc(100% - 4rem), transparent);
		-webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 4rem), transparent);
		/* すぐ切り替わるときはシマーを出さない（チラつき防止）。少しかかるときだけ浮かび上がる */
		animation: page-fade 200ms ease-out 140ms both;
	}
	.page-leaving {
		animation: page-fade 150ms ease-out reverse both;
	}
	@keyframes page-fade {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	/* 同じページで条件だけ変えて読み込み中: いちばん内側の枠だけ、結果の欄（RefreshingResults）が無いページの中身を少し薄くする */
	:global([data-refreshing]:not(:has([data-refreshing], [data-results])) > [data-transition-content] > *) {
		opacity: 0.55;
		transition: opacity 200ms ease-out 140ms;
	}
	@media (prefers-reduced-motion: reduce) {
		.home-loading:not(.initial), .home-spinner { animation: none; }
		.home-loading.initial { animation-duration: 0s; }
		.transition-layer { animation: none; }
		.page-leaving { animation: none; opacity: 0; }
	}
	.transition-viewport {
		position: sticky;
		inset-block-start: var(--page-loading-top, 4.25rem);
	}
	[data-transition-shell='root'] .transition-viewport {
		inset-block-start: 0;
	}
</style>
