<script lang="ts">
	import PlanCard from '$lib/components/PlanCard.svelte';
	import { page } from '$app/state';

	let { data } = $props();
	let base = $derived(`/${data.facility.brandSlug}/${data.facility.slug}`);

	function tagHref(tag: string) {
		const q = new URLSearchParams(page.url.searchParams);
		if (q.get('tag') === tag) q.delete('tag');
		else q.set('tag', tag);
		return `${base}/plans?${q}`;
	}

	function planHref(slug: string) {
		const q = new URLSearchParams(page.url.searchParams);
		q.delete('tag');
		const s = q.toString();
		return `${base}/plans/${slug}${s ? '?' + s : ''}`;
	}
</script>

<svelte:head>
	<title>プラン一覧 ｜ {data.facility.name}</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8">
	<nav class="mb-2 text-xs text-stone-400">
		<a href={base} class="hover:underline">{data.facility.name}</a> / プラン一覧
	</nav>
	<h1 class="font-display mb-4 text-2xl text-brand-900">プラン一覧</h1>

	{#if data.params.checkin}
		<p class="mb-3 text-sm text-stone-500">{data.params.checkin} から {data.params.nights}泊・大人{data.params.adults}名 の料金を表示中</p>
	{:else}
		<p class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">日付未指定のため基準料金を表示しています。上の検索バーで日付を選ぶと総額が出ます。</p>
	{/if}

	<!-- 絞り込みチップ -->
	<div class="mb-6 flex flex-wrap gap-2">
		{#each data.allTags as tag}
			<a
				href={tagHref(tag)}
				class="rounded-full border px-3 py-1 text-sm transition {data.params.tag === tag
					? 'border-brand-800 bg-brand-800 text-white'
					: 'border-stone-300 text-stone-600 hover:bg-stone-100'}"
			>
				{tag}
			</a>
		{/each}
	</div>

	<div class="space-y-4">
		{#each data.items as item}
			{#if item.total !== null || !data.params.checkin}
				<PlanCard
					plan={item.plan}
					href={planHref(item.plan.slug)}
					total={item.total}
					perPerson={item.perPerson}
					adults={data.params.adults}
					remaining={item.remaining}
					checkin={data.params.checkin}
				/>
			{:else}
				<div class="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-400">
					<p class="font-medium text-stone-500">{item.plan.name}</p>
					<p>この条件では満室です。日付を変えてお試しください。</p>
				</div>
			{/if}
		{:else}
			<p class="text-sm text-stone-500">該当するプランがありません。</p>
		{/each}
	</div>
</div>
