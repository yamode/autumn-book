<script lang="ts">
	import type { Snippet } from 'svelte';
	import { pendingPage, transitionTitle, loadingShape } from '$lib/page-transition';
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

	// 画面の切り替えはフェードでつなぐ（2026-11-18 指示「パッパッと切り替わって疲れる」）。
	// 出ていく画面は CSS（.page-leaving）で薄くし、読み込みが少しかかるときだけシマーが浮かぶ（.transition-layer の遅延）。
	// 新しい画面が入ったら、その中身をふわっと出す（中身の枠は display: contents なので子要素ごとに）。
	let content = $state<HTMLElement>();
	let wasPending = false;
	$effect(() => {
		const now = Boolean(pending);
		if (wasPending && !now && content && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
			for (const el of content.children) {
				(el as HTMLElement).animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' });
			}
		}
		wasPending = now;
	});
</script>

<div class={pending ? 'transition-frame' : 'contents'}>
	<!-- Keep the outgoing page mounted and preserve its size until the router records scroll and commits. -->
	<div bind:this={content} data-transition-content class={pending ? 'page-leaving' : 'contents'} inert={Boolean(pending)} aria-hidden={pending ? 'true' : undefined}>
		{@render children()}
	</div>
	{#if pending}
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
	.transition-frame {
		position: relative;
		display: flow-root;
		min-block-size: min(33rem, 82svh);
	}
	.transition-layer {
		position: absolute;
		inset: 0;
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
	@media (prefers-reduced-motion: reduce) {
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
