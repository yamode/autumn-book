<script lang="ts">
	import { enhance } from '$app/forms';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
	import { formatYen } from '$lib/format';

	let { data, form } = $props();
	let p = $derived(data.plan);
	let description = $state(data.plan.description);
</script>

<svelte:head><title>プラン編集 ｜ 山人管理</title></svelte:head>

<nav class="mb-3 text-xs text-stone-400"><a href="/admin/plans" class="hover:underline">プラン</a> / {p.name}</nav>

{#if form?.saved}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">保存しました。</p>{/if}
{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}

<!-- Step 1: 料金プラン（rms 管理・読み取り専用） -->
<section class="rounded-xl border border-stone-200 bg-white p-5">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-bold text-stone-700">Step 1 ─ 料金プラン（rms で管理）</h2>
		<span class="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-500">読み取り専用</span>
	</div>
	<dl class="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
		<div class="flex gap-2"><dt class="text-stone-400">プラン名</dt><dd class="font-medium">{p.name}</dd></div>
		<div class="flex gap-2"><dt class="text-stone-400">基準料金</dt><dd>{formatYen(p.basePrice)} / 大人1名1泊（平日）</dd></div>
		<div class="flex gap-2"><dt class="text-stone-400">食事</dt><dd>{p.mealPlan}</dd></div>
		<div class="flex gap-2"><dt class="text-stone-400">支払</dt><dd>{p.paymentMethod === 'card' ? '事前カード決済' : '現地払い'}</dd></div>
		<div class="flex gap-2"><dt class="text-stone-400">対象客室</dt><dd>{data.rooms.join(' / ')}</dd></div>
		<div class="col-span-full flex gap-2"><dt class="shrink-0 text-stone-400">キャンセル規定</dt><dd class="text-xs text-stone-600">{p.cancellationPolicy.note}</dd></div>
	</dl>
	<p class="mt-3 text-xs text-stone-400">料金・在庫・規定の変更は rms（料金管理）で行ってください。</p>
</section>

<!-- Step 2: 見せ方（plan_contents） -->
<form method="POST" action="?/save" use:enhance class="mt-4 space-y-4 rounded-xl border border-stone-200 bg-white p-5">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-bold text-stone-700">Step 2 ─ 見せ方をつくる（公開コンテンツ）</h2>
		<a href="/{data.facility.brandSlug}/{data.facility.slug}/plans/{p.slug}" target="_blank" class="rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50">顧客画面でプレビュー ↗</a>
	</div>

	<label class="block text-sm">
		<span class="text-stone-600">キャッチコピー（headline）</span>
		<input name="headline" value={p.headline} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
	</label>

	<label class="block text-sm">
		<span class="text-stone-600">タグ（「、」区切り — 一覧の絞り込みチップになります）</span>
		<input name="tags" value={p.highlightTags.join('、')} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder="露天風呂付、記念日、一人旅" />
	</label>

	<div class="text-sm">
		<span class="text-stone-600">プラン本文（Markdown — 右がそのまま顧客画面の表示）</span>
		<div class="mt-1">
			<MarkdownEditor bind:value={description} name="description" rows={18} photos={[...p.photos, ...data.facility.photos]} />
		</div>
	</div>

	<div class="flex flex-wrap items-center gap-6">
		<label class="flex items-center gap-2 text-sm">
			<span class="text-stone-600">表示順</span>
			<input type="number" name="sortOrder" value={p.sortOrder} min="1" class="w-20 rounded-md border border-stone-300 px-3 py-1.5" />
		</label>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" name="isPublished" checked={p.isPublished} class="h-4 w-4" />
			<span>公開する（OFF=下書き）</span>
		</label>
	</div>

	<button type="submit" class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">保存する</button>
</form>
