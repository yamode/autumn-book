<script lang="ts">
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();

	// ja 以外では翻訳参考訳の注記を表示（設計書 §1.2）
	let showTranslationNotice = $derived(getLocale() !== 'ja');
</script>

<svelte:head><title>{m.legal_title({ title: data.page.title })}</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-10">
	<h1 class="font-display mb-6 text-2xl text-brand-900">{data.page.title}</h1>

	{#if showTranslationNotice}
		<p class="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
			{m.legal_translation_notice()}
		</p>
	{/if}

	<MarkdownView source={data.page.body} />
</div>
