<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';

	let { source }: { source: string } = $props();
	let html = $derived(renderMarkdown(source));
</script>

<!-- 生 HTML は renderMarkdown 側でエスケープ済み（設計書 §2.3） -->
<div class="prose-ab">
	{@html html}
</div>

<style>
	.prose-ab :global(h2) {
		font-size: 1.15rem;
		font-weight: 600;
		margin: 1.25em 0 0.5em;
		padding-left: 0.6em;
		border-left: 3px solid var(--color-accent-500, #b08d3e);
	}
	.prose-ab :global(h3) {
		font-size: 1rem;
		font-weight: 600;
		margin: 1em 0 0.4em;
	}
	.prose-ab :global(p) {
		margin: 0.5em 0;
		line-height: 1.8;
	}
	.prose-ab :global(ul) {
		list-style: disc;
		padding-left: 1.4em;
		margin: 0.5em 0;
	}
	.prose-ab :global(ol) {
		list-style: decimal;
		padding-left: 1.4em;
		margin: 0.5em 0;
	}
	.prose-ab :global(table) {
		border-collapse: collapse;
		margin: 0.75em 0;
		font-size: 0.9em;
	}
	.prose-ab :global(th),
	.prose-ab :global(td) {
		border: 1px solid #d6d3d1;
		padding: 0.4em 0.8em;
	}
	.prose-ab :global(th) {
		background: #f5f5f4;
	}
	.prose-ab :global(img) {
		border-radius: 0.5rem;
		margin: 0.75em 0;
	}
	.prose-ab :global(a) {
		color: #95742c;
		text-decoration: underline;
	}
</style>
