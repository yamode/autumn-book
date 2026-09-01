<script lang="ts">
	// 館内のご案内 1件。ヘッダー（黒・戻る＋中央タイトル）はシェル側が出す。
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import { inroomCardImage, inroomIcon } from '$lib/inroom-visuals';

	let { data } = $props();

	const img = $derived(inroomCardImage(data.stay.facility.slug, data.guide.section));
</script>

<svelte:head><title>{data.guide.title} ｜ YAMADO</title></svelte:head>

{#if img}
	<img src={img} alt="" class="h-40 w-full object-cover" />
{/if}

<article class="bg-white px-5 py-5">
	<div class="flex items-start gap-3">
		<svg
			viewBox="0 0 24 24"
			class="mt-1 h-6 w-6 shrink-0 text-stone-500"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true">
			<path d={inroomIcon(data.guide.section)} />
		</svg>
		<div class="min-w-0 flex-1">
			<h1 class="text-xl font-medium leading-snug text-stone-900">{data.guide.title}</h1>
			<div class="guide-body mt-3 text-[15px] leading-7 text-stone-700">
				<MarkdownView source={data.guide.body} />
			</div>
		</div>
	</div>
</article>

<div class="px-4 py-4">
	<a href="/r" class="block rounded-lg bg-white py-3 text-center text-sm text-stone-600 shadow-card">
		客室のご案内へ戻る
	</a>
</div>

<style>
	/* 現行アプリの本文の見え方に寄せる（見出しは控えめ・箇条書きは詰めすぎない） */
	.guide-body :global(h3) {
		margin-top: 1.4em;
		margin-bottom: 0.4em;
		font-size: 1.02em;
		font-weight: 600;
		color: #1c1917;
	}
	.guide-body :global(p) {
		margin: 0.6em 0;
	}
	.guide-body :global(ul) {
		margin: 0.5em 0;
		padding-left: 1.2em;
		list-style: disc;
	}
	.guide-body :global(li) {
		margin: 0.25em 0;
	}
	.guide-body :global(a) {
		color: #3f6212;
		text-decoration: underline;
	}
	.guide-body :global(table) {
		width: 100%;
		border-collapse: collapse;
		margin: 0.6em 0;
	}
	.guide-body :global(th),
	.guide-body :global(td) {
		border-bottom: 1px solid #e7e5e4;
		padding: 0.4em 0.2em;
		text-align: left;
	}
</style>
