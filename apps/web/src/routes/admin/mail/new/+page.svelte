<script lang="ts">
	import { enhance } from '$app/forms';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';

	let { form } = $props();

	let body = $state(form?.values?.body ?? '');
	let confirming = $state(false);

	// アクション往復後も本文を維持
	$effect(() => {
		if (form?.values?.body !== undefined && form.values.body !== body) body = form.values.body;
	});

	const ranks = [
		{ code: 'standard', label: 'スタンダード' },
		{ code: 'silver', label: 'シルバー' },
		{ code: 'gold', label: 'ゴールド' }
	];
</script>

<svelte:head><title>メルマガ作成 ｜ 山人管理</title></svelte:head>

<nav class="mb-3 text-xs text-stone-400"><a href="/admin/mail" class="hover:underline">メルマガ</a> / 新規作成</nav>

{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}
{#if form?.tested}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">テストメールを送信しました（自分宛・デモ）。</p>{/if}

<form method="POST" use:enhance class="space-y-4">
	<!-- ステップ1: 本文 -->
	<section class="rounded-xl border border-stone-200 bg-white p-5">
		<h2 class="mb-3 text-sm font-bold text-stone-700">① 本文を作成</h2>
		<div class="space-y-3">
			<label class="block text-sm">
				<span class="text-stone-600">管理用タイトル</span>
				<input name="title" value={form?.values?.title ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder="初夏の男鹿・夕陽の便り" />
			</label>
			<label class="block text-sm">
				<span class="text-stone-600">件名</span>
				<input name="subject" value={form?.values?.subject ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder="【山人】…" />
			</label>
			<div class="text-sm">
				<span class="text-stone-600">本文（Markdown・差込変数はツールバーから挿入）</span>
				<div class="mt-1">
					<MarkdownEditor bind:value={body} name="body" rows={14} variables={['氏名', 'ランク', 'ポイント残高']} />
				</div>
			</div>
			<p class="rounded bg-stone-50 px-3 py-2 text-xs text-stone-500">
				フッターの<strong>配信停止リンク・送信者表示は自動付与</strong>されます（特定電子メール法・編集不可）。
			</p>
		</div>
	</section>

	<!-- ステップ2: 宛先 -->
	<section class="rounded-xl border border-stone-200 bg-white p-5">
		<h2 class="mb-3 text-sm font-bold text-stone-700">② 宛先（セグメント）</h2>
		<p class="mb-2 text-xs text-stone-500">☑ メルマガ受信 ON の会員のみ（固定）</p>
		<div class="flex flex-wrap gap-4 text-sm">
			{#each ranks as r}
				<label class="flex items-center gap-1.5">
					<input type="checkbox" name="ranks" value={r.code} checked={form?.values?.ranks?.includes(r.code) ?? false} class="h-4 w-4" />
					{r.label}
				</label>
			{/each}
			<span class="text-xs text-stone-400">（未選択 = 全ランク）</span>
		</div>
		<p class="mt-2 text-xs text-stone-400">宿泊履歴・お気に入り施設による絞り込みは P7 で追加（設計書 §15.5）。</p>
		<div class="mt-3 flex items-center gap-3">
			<button formaction="?/count" class="rounded-md border border-stone-300 px-4 py-1.5 text-sm hover:bg-stone-50">対象者を数える</button>
			{#if form?.count !== undefined}
				<span class="text-sm font-medium text-brand-900">現在 {form.count} 名が対象です</span>
			{/if}
			<button formaction="?/test" class="rounded-md border border-stone-300 px-4 py-1.5 text-sm hover:bg-stone-50">テスト送信（自分宛）</button>
		</div>
	</section>

	<!-- ステップ3: 配信 -->
	<section class="rounded-xl border border-stone-200 bg-white p-5">
		<h2 class="mb-3 text-sm font-bold text-stone-700">③ 配信</h2>
		<div class="flex flex-wrap items-center gap-4 text-sm">
			<label class="flex items-center gap-1.5"><input type="radio" name="schedule" value="now" checked class="h-4 w-4" /> 今すぐ配信</label>
			<label class="flex items-center gap-1.5">
				<input type="radio" name="schedule" value="later" class="h-4 w-4" /> 日時指定
				<input type="datetime-local" name="scheduledAt" class="rounded-md border border-stone-300 px-2 py-1" />
			</label>
		</div>

		{#if !confirming}
			<button type="button" onclick={() => (confirming = true)} class="mt-4 rounded-lg bg-accent-600 px-6 py-2 text-sm font-medium text-white hover:bg-accent-500">
				配信内容を確認する
			</button>
		{:else}
			<div class="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
				<p class="font-medium text-amber-900">この内容で配信します。よろしいですか？（二段確認）</p>
				<p class="mt-1 text-xs text-amber-800">配信後の取り消しはできません。対象者数は「対象者を数える」で必ず確認してください。</p>
				<div class="mt-3 flex gap-2">
					<button formaction="?/send" class="rounded-md bg-brand-800 px-6 py-2 text-white hover:bg-brand-700">配信を確定する</button>
					<button type="button" onclick={() => (confirming = false)} class="rounded-md border border-stone-300 bg-white px-6 py-2">戻る</button>
				</div>
			</div>
		{/if}
	</section>
</form>
