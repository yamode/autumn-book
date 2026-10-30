<script lang="ts">
	import { planAccessSummaryJa } from '$lib/plan-access';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import { enhance } from '$lib/enhance';
	import { MEAL_PLANS, PLAN_NAME_MAX } from '$lib/plan-meal';
	let { data, form } = $props();
	let creating = $state(false);
	const PAYMENT_LABEL = { onsite: '現地払い', prepayment: '事前決済', deposit: '事前・現地' } as const;
	let filter = $state<'all' | 'published' | 'draft'>('all');
	let shown = $derived(
		data.plans.filter((p) => (filter === 'all' ? true : filter === 'published' ? p.isPublished : !p.isPublished))
	);
	let publishedCount = $derived(data.plans.filter((p) => p.isPublished).length);
</script>

<svelte:head><title>プラン ｜ 山人管理</title></svelte:head>

<PageHeader
	title="プラン"
	facility={data.currentFacility.name}
	description="ここで「見せ方」を作ります。料金・在庫・キャンセル規定は rms 側です（rms で先に作っても、ここで先に作って rms であとから紐づけてもかまいません）"
>
	{#snippet actions()}
		<a href="/admin/plans/templates" class="inline-flex min-h-10 items-center rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 hover:border-brand-800">紹介文テンプレート</a>
	{/snippet}
</PageHeader>

{#if data.live}
	<!-- Book 先行: プランをここで先に作り、料金は rms のプランテンプレートであとから紐づける -->
	<details class="mb-4 rounded-xl border border-stone-200 bg-white p-4" open={!!(form as { createError?: string } | null)?.createError}>
		<summary class="cursor-pointer text-sm font-medium text-stone-700">＋ 新規プランを作る（料金はあとで rms から紐づけ）</summary>
		<form
			method="POST"
			action="?/create"
			use:enhance={() => {
				creating = true;
				return async ({ update }) => {
					await update({ reset: false });
					creating = false;
				};
			}}
			class="mt-3 grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
		>
			<label class="block text-xs text-stone-500">プラン名
				<input name="name" required maxlength={PLAN_NAME_MAX} value={(form as { name?: string } | null)?.name ?? ''} class="mt-1 block min-h-10 w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800" />
			</label>
			<label class="block text-xs text-stone-500">食事
				<select name="meal_plan" class="mt-1 block min-h-10 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800">
					<option value="">あとで決める</option>
					{#each MEAL_PLANS as m (m)}<option value={m}>{m}</option>{/each}
				</select>
			</label>
			<button type="submit" disabled={creating} class="min-h-10 rounded-md bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-900 disabled:opacity-50">{creating ? '作成中…' : '作成して編集へ'}</button>
		</form>
		{#if (form as { createError?: string } | null)?.createError}<p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{(form as { createError?: string }).createError}</p>{/if}
		<p class="mt-2 text-xs text-stone-500">作ったプランは「料金待ち」の下書きです。rms の料金管理でプランを作り、「Book のプランに紐づける」で結びつけると、料金が入って予約を受けられるようになります。</p>
	</details>
{/if}

{#if data.loadError}
	<p class="mb-4 rounded-lg px-3 py-2 text-sm {data.live ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-900'}">{data.loadError}</p>
{/if}
{#if data.namesError}
	<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{data.namesError}（プラン名の代わりに識別子を表示しています）</p>
{/if}

<div class="mb-4 flex flex-wrap gap-1.5 text-xs">
	{#each [['all', `すべて ${data.plans.length}`], ['published', `公開中 ${publishedCount}`], ['draft', `下書き ${data.plans.length - publishedCount}`]] as [k, label] (k)}
		<button
			type="button"
			onclick={() => (filter = k as typeof filter)}
			class="rounded-full px-3 py-1.5 {filter === k ? 'bg-brand-800 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}"
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
				{#if plan.rmsState === 'awaiting'}<span class="absolute bottom-2 left-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">料金待ち（rms 未紐づけ）</span>{/if}
				{#if plan.paymentMethod}
					<span class="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs text-stone-700">{PAYMENT_LABEL[plan.paymentMethod]}{plan.paymentMethod !== 'onsite' && plan.prepayDiscountRate > 0 ? `・${Math.round(plan.prepayDiscountRate * 100)}%OFF` : ''}</span>
				{/if}
			</div>
			<div class="p-3">
				{#if planAccessSummaryJa(plan.access)}
					<span class="mb-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">◆ {planAccessSummaryJa(plan.access)}</span>
				{/if}
				<h2 class="line-clamp-2 text-sm font-medium text-stone-800 group-hover:underline">{plan.name}</h2>
				<p class="mt-0.5 truncate text-xs text-stone-500">{plan.headline || '（見出し未入力）'}</p>
				<p class="mt-1 text-[11px] text-stone-400">
					表示順 {plan.sortOrder}・写真 {plan.photos.length}・仕様 {plan.specs.length}・ブロック {plan.sections.length}
					{#if plan.rmsState !== 'awaiting' && (!plan.isActive || !plan.publicOnDirect)}<span class="text-rose-600">・rms で直販対象外</span>{/if}
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
