<script lang="ts">
	let { data } = $props();
	let filter = $state<'all' | 'published' | 'draft'>('all');
	let shown = $derived(
		data.plans.filter((p) => (filter === 'all' ? true : filter === 'published' ? p.isPublished : !p.isPublished))
	);
	let publishedCount = $derived(data.plans.filter((p) => p.isPublished).length);
</script>

<svelte:head><title>プラン ｜ 山人管理</title></svelte:head>

<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
	<h1 class="text-lg font-bold text-stone-800">プラン — {data.currentFacility.name}</h1>
	<p class="text-xs text-stone-400">プランの新規作成（料金・在庫・キャンセル規定）は rms 側で行い、ここで「見せ方」を作ります</p>
</div>

{#if data.loadError}
	<p class="mb-4 rounded-lg px-3 py-2 text-sm {data.live ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}">{data.loadError}</p>
{/if}
{#if data.namesError}
	<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{data.namesError}（プラン名の代わりに識別子を表示しています）</p>
{/if}

<div class="mb-3 flex gap-1 text-xs">
	{#each [['all', `すべて ${data.plans.length}`], ['published', `公開中 ${publishedCount}`], ['draft', `下書き ${data.plans.length - publishedCount}`]] as [k, label] (k)}
		<button
			type="button"
			onclick={() => (filter = k as typeof filter)}
			class="rounded-full px-3 py-1 {filter === k ? 'bg-brand-800 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}"
		>{label}</button>
	{/each}
</div>

<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
	{#each shown as plan (plan.id)}
		<a href="/admin/plans/{plan.id}" class="group overflow-hidden rounded-xl border border-stone-200 bg-white transition hover:shadow-md">
			<div class="relative">
				{#if plan.photos[0]}
					<img src={plan.photos[0].url} alt={plan.name} class="h-36 w-full object-cover" />
				{:else}
					<div class="flex h-36 w-full items-center justify-center bg-stone-100 text-xs text-stone-400">写真なし</div>
				{/if}
				<span class="absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-medium {plan.isPublished ? 'bg-emerald-500 text-white' : 'bg-stone-600 text-white'}">
					{plan.isPublished ? '公開中' : '下書き'}
				</span>
			</div>
			<div class="p-3">
				<h2 class="line-clamp-2 text-sm font-medium text-stone-800 group-hover:underline">{plan.name}</h2>
				<p class="mt-0.5 truncate text-xs text-stone-500">{plan.headline || '（見出し未入力）'}</p>
				<p class="mt-1 text-[11px] text-stone-400">
					表示順 {plan.sortOrder}・写真 {plan.photos.length}・仕様 {plan.specs.length}・ブロック {plan.sections.length}
					{#if !plan.isActive || !plan.publicOnDirect}<span class="text-rose-600">・rms で直販対象外</span>{/if}
				</p>
				<div class="mt-1.5 flex flex-wrap gap-1">
					{#each plan.tags as t (t)}
						<span class="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] text-brand-700">{t}</span>
					{/each}
				</div>
			</div>
		</a>
	{:else}
		<p class="text-sm text-stone-500">該当するプランがありません。</p>
	{/each}
</div>
