<script lang="ts">
	import PlanCard from '$lib/components/PlanCard.svelte';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';

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
	<title>{m.plans_title({ name: data.facility.name })}</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8">
	<nav class="mb-2 text-xs text-stone-400">
		<a href={base} class="hover:underline">{data.facility.name}</a> / {m.plans_breadcrumb()}
	</nav>
	<h1 class="font-display mb-4 text-2xl text-brand-900">{m.plans_heading()}</h1>

	{#if data.params.checkin}
		<p class="mb-3 text-sm text-stone-500">{m.plans_date_info({ checkin: data.params.checkin, nights: String(data.params.nights), adults: String(data.params.adults) })}</p>
	{:else}
		<p class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{m.plans_no_date()}</p>
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
					<p>{m.plans_sold_out_msg()}</p>
				</div>
			{/if}
		{:else}
			<p class="text-sm text-stone-500">{m.plans_no_results()}</p>
		{/each}
	</div>
</div>
