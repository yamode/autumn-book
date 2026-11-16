<script lang="ts">
	import type { Snippet } from 'svelte';
	import { pendingPage, transitionTitle } from '$lib/page-transition';
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
</script>

<div class={pending ? 'transition-frame' : 'contents'}>
	<!-- Keep the outgoing page mounted and preserve its size until the router records scroll and commits. -->
	<div data-transition-content class={pending ? 'opacity-0' : 'contents'} inert={Boolean(pending)} aria-hidden={pending ? 'true' : undefined}>
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
						<PageLoadingSkeleton title={title ?? transitionTitle(pending.route.id ?? '')} />
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
	}
	.transition-viewport {
		position: sticky;
		inset-block-start: var(--page-loading-top, 4.25rem);
	}
	[data-transition-shell='root'] .transition-viewport {
		inset-block-start: 0;
	}
</style>
