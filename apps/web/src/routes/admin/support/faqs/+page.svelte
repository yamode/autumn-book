<script lang="ts">
	// ヘルプページ（/help）のよくある質問の編集。カテゴリごと・並び順（小さい順）でヘルプページに出る
	import { enhance } from '$lib/enhance';
	import type { SubmitFunction } from '@sveltejs/kit';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import { groupFaqs, SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, supportCategoryLabel } from '$lib/support';

	let { data, form } = $props();

	const groups = $derived(groupFaqs(data.faqs));
	const failure = $derived(form && 'message' in form && form.message ? { message: String(form.message), id: 'id' in form ? (form.id as string | null | undefined) : undefined } : null);
	const DONE_LABEL = { create: '追加しました。', update: '保存しました。', delete: '削除しました。' } as const;
	const done = $derived(form && 'done' in form && form.done ? DONE_LABEL[form.done as keyof typeof DONE_LABEL] : null);

	// 追加フォーム: 追加できたら質問と回答だけ空にする（カテゴリ・並び順・公開のチェックは続けて追加しやすいよう残す）
	let newQuestion = $state('');
	let newAnswer = $state('');
	const afterCreate: SubmitFunction = () => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type === 'success') {
			newQuestion = '';
			newAnswer = '';
		}
	};

	const confirmDelete =
		(q: string): SubmitFunction =>
		({ cancel }) => {
			if (!confirm(`「${q}」を削除します。元に戻せません。よろしいですか？（隠すだけなら「公開する」を外して保存してください）`)) cancel();
		};
</script>

<svelte:head><title>よくある質問の編集 ｜ 会員サポート ｜ 山人管理</title></svelte:head>

<p class="mb-2 text-sm"><a href="/admin/support" class="text-accent-600 hover:underline">← 会員サポートの一覧</a></p>
<PageHeader title="よくある質問の編集" description="ヘルプページ（/help）に出す、会員システムについてのよくある質問です。カテゴリごとに、並び順の小さい順で並びます。回答は文字だけ（改行はそのまま出ます）。施設の FAQ ボット（サイト管理 → FAQ）とは別です。">
	{#snippet actions()}
		<a href="/help" target="_blank" rel="noopener" class="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:border-stone-500">ヘルプページを開く ↗</a>
	{/snippet}
</PageHeader>

{#if !data.live}
	<div class="mb-4 rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-500">
		この環境では使えません（DATA_SOURCE / AUTH_MODE が supabase ではありません）。
	</div>
{/if}
{#if data.error}
	<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{data.error}</div>
{/if}
{#if failure && failure.id === undefined}
	<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{failure.message}</div>
{/if}
{#if done}
	<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{done}</div>
{/if}

{#snippet fields(f: { category: string; question: string; answer: string; sort_order: number; is_published: boolean } | null, isNew = false)}
	<div class="grid gap-3 sm:grid-cols-[12rem_6rem_1fr]">
		<label class="block text-xs">
			<span class="text-stone-500">カテゴリ</span>
			<select name="category" required class="mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm">
				{#each SUPPORT_CATEGORIES as c (c)}
					<option value={c} selected={(f?.category ?? 'login') === c}>{SUPPORT_CATEGORY_LABELS[c]}</option>
				{/each}
			</select>
		</label>
		<label class="block text-xs">
			<span class="text-stone-500">並び順</span>
			<input type="number" name="sortOrder" step="1" value={f?.sort_order ?? 100} class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
		</label>
		<label class="flex items-end gap-2 pb-1.5 text-sm">
			<input type="checkbox" name="isPublished" checked={f?.is_published ?? true} class="h-4 w-4" />
			<span>公開する</span>
		</label>
	</div>
	<label class="mt-3 block text-xs">
		<span class="text-stone-500">質問</span>
		{#if isNew}
			<input name="question" required maxlength="300" bind:value={newQuestion} class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
		{:else}
			<input name="question" required maxlength="300" value={f?.question ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
		{/if}
	</label>
	<label class="mt-3 block text-xs">
		<span class="text-stone-500">回答</span>
		{#if isNew}
			<textarea name="answer" required maxlength="5000" rows="4" bind:value={newAnswer} class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"></textarea>
		{:else}
			<textarea name="answer" required maxlength="5000" rows="4" value={f?.answer ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"></textarea>
		{/if}
	</label>
{/snippet}

<details class="mb-6 rounded-xl border border-stone-200 bg-white p-4 text-sm" open={data.faqs.length === 0}>
	<summary class="cursor-pointer font-medium text-stone-800">＋ よくある質問を追加する</summary>
	<form method="POST" action="?/create" use:enhance={afterCreate} class="mt-3">
		{@render fields(null, true)}
		{#if failure && failure.id === null}<p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{failure.message}</p>{/if}
		<div class="mt-3 flex justify-end">
			<button class="rounded-md bg-brand-800 px-4 py-2 text-white hover:bg-brand-700">追加する</button>
		</div>
	</form>
</details>

{#each groups as g (g.category)}
	<h2 class="mb-2 text-sm font-medium text-stone-700">{supportCategoryLabel(g.category)}（{g.items.length} 件）</h2>
	<div class="mb-6 space-y-3">
		{#each g.items as f (f.id)}
			<details class="rounded-xl border border-stone-200 bg-white p-4 text-sm" open={failure?.id === f.id}>
				<summary class="flex cursor-pointer flex-wrap items-center gap-2">
					<span class="font-mono text-xs text-stone-400">{f.sort_order}</span>
					<span class="min-w-0 flex-1 font-medium text-stone-800">{f.question}</span>
					{#if !f.is_published}<span class="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-500">非公開</span>{/if}
				</summary>
				<form method="POST" action="?/update" use:enhance class="mt-3">
					<input type="hidden" name="id" value={f.id} />
					{@render fields(f)}
					{#if failure && failure.id === f.id}<p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{failure.message}</p>{/if}
					<div class="mt-3 flex justify-end">
						<button class="rounded-md bg-brand-800 px-4 py-2 text-white hover:bg-brand-700">保存する</button>
					</div>
				</form>
				<form method="POST" action="?/delete" use:enhance={confirmDelete(f.question)} class="mt-2 flex justify-end border-t border-stone-100 pt-2">
					<input type="hidden" name="id" value={f.id} />
					<button class="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:border-red-500">削除する</button>
				</form>
			</details>
		{/each}
	</div>
{:else}
	{#if data.live && !data.error}<p class="rounded-xl border border-stone-200 bg-white px-4 py-8 text-center text-sm text-stone-400">よくある質問はまだありません</p>{/if}
{/each}
