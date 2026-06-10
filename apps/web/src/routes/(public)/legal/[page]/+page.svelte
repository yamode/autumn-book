<script lang="ts">
	import MarkdownView from '$lib/components/MarkdownView.svelte';

	let { data } = $props();
</script>

<svelte:head><title>{data.page.title} ｜ 山人</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-10">
	<h1 class="font-display mb-6 text-2xl text-brand-900">{data.page.title}</h1>
	<MarkdownView source={data.page.body} />
</div>
