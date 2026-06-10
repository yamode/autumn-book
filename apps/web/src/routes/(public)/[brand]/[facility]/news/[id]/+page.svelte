<script lang="ts">
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import * as m from '$lib/paraglide/messages';
	import { formatDateLong } from '$lib/format';

	let { data } = $props();
	let base = $derived(`/${data.facility.brandSlug}/${data.facility.slug}`);
</script>

<svelte:head><title>{data.post.title} ｜ {data.facility.name}</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-10">
	<nav class="mb-4 text-xs text-stone-400">
		<a href={base} class="hover:underline">{data.facility.name}</a> /
		<a href="{base}/news" class="hover:underline">{m.news_title()}</a>
	</nav>

	<article class="rounded-2xl border border-stone-200 bg-white p-6 sm:p-8">
		<time class="text-sm text-stone-400">{formatDateLong(data.post.publishedAt)}</time>
		<h1 class="font-display mt-2 text-2xl leading-snug text-brand-900">{data.post.title}</h1>
		<div class="mt-6">
			<MarkdownView source={data.post.body} />
		</div>
	</article>

	<p class="mt-6">
		<a href="{base}/news" class="text-sm text-accent-600 hover:underline">← {m.news_back()}</a>
	</p>
</div>
