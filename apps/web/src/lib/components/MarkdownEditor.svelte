<script lang="ts">
	import MarkdownView from './MarkdownView.svelte';
	import { MD_RED } from '$lib/markdown';
	import type { Photo } from '$lib/types';
	import { expandPlanText, templateToken, type PlanTextTemplate } from '$lib/plan-templates';
	import { MORE_MARKER } from '$lib/plan-summary';

	let {
		value = $bindable(''),
		name = 'body',
		rows = 16,
		photos = [],
		variables = [],
		templates = [],
		moreButton = false
	}: {
		value?: string;
		name?: string;
		rows?: number;
		photos?: Photo[];
		variables?: string[];
		/** プラン紹介文のテンプレート（挿入ボタンを出し、プレビューでは展開して見せる） */
		templates?: PlanTextTemplate[];
		/** 「ここまで一覧に表示」（<!--more-->）の挿入ボタンを出す（プラン紹介文） */
		moreButton?: boolean;
	} = $props();
	let showTemplates = $state(false);
	const preview = $derived(templates.length ? expandPlanText(value, templates) : { text: value, perks: [] });
	// プレビューでは区切りの位置に目印を出す（本番の表示では区切りは出ない）
	const previewText = $derived(moreButton ? preview.text.replace(/^[ \t　]*<!--\s*more\s*-->[ \t　]*$/gm, '\n\n---\n\n*（ここまでがプラン一覧の紹介文）*\n\n') : preview.text);

	let textarea: HTMLTextAreaElement;
	let showPicker = $state(false);
	let mobileTab = $state<'edit' | 'preview'>('edit');

	// 選んだ文字を before/after で囲む。選んでいなければ placeholder を入れて、それを選んだ状態にする
	function wrap(before: string, after: string, placeholder: string) {
		const start = textarea.selectionStart ?? value.length;
		const end = textarea.selectionEnd ?? value.length;
		const selected = value.slice(start, end) || placeholder;
		value = value.slice(0, start) + before + selected + after + value.slice(end);
		queueMicrotask(() => {
			textarea.focus();
			textarea.selectionStart = start + before.length;
			textarea.selectionEnd = start + before.length + selected.length;
		});
	}

	// リンク: 選んだ文字（無ければ「リンクの文字」）を [文字](URL) にする。URL は聞いて入れる（空ならやめる）
	function addLink() {
		const start = textarea.selectionStart ?? value.length;
		const end = textarea.selectionEnd ?? value.length;
		const selected = value.slice(start, end);
		const url = window.prompt('リンク先のURL（https://… ・電話は tel:0197… ）', /^https?:\/\//.test(selected) ? selected : 'https://');
		if (!url || url === 'https://') return;
		const label = selected && !/^https?:\/\//.test(selected) ? selected : 'リンクの文字';
		const snippet = `[${label}](${url.trim()})`;
		value = value.slice(0, start) + snippet + value.slice(end);
		queueMicrotask(() => {
			textarea.focus();
			// 文字を選んでいなかったときは、差し替えやすいよう「リンクの文字」を選んでおく
			textarea.selectionStart = start + 1;
			textarea.selectionEnd = start + 1 + label.length;
		});
	}

	function insert(snippet: string) {
		const start = textarea.selectionStart ?? value.length;
		const end = textarea.selectionEnd ?? value.length;
		value = value.slice(0, start) + snippet + value.slice(end);
		queueMicrotask(() => {
			textarea.focus();
			textarea.selectionStart = textarea.selectionEnd = start + snippet.length;
		});
	}
</script>

<div class="rounded-xl border border-stone-300 bg-white">
	<div class="flex flex-wrap items-center gap-1 border-b border-stone-200 px-2 py-1.5">
		<button type="button" class="tb" onclick={() => insert('\n## 見出し\n')}>見出し</button>
		<!-- 文字を選んで押すと、その文字を囲む（選んでいなければ見本の文字を入れて選ぶ・2026-10-17） -->
		<button type="button" class="tb font-bold" title="太字" onclick={() => wrap('**', '**', '太字')}>B</button>
		<button type="button" class="tb font-semibold" style="color:{MD_RED}" title="赤字（==文字==）" onclick={() => wrap('==', '==', '赤字')}>赤字</button>
		<button type="button" class="tb" title="リンク（[文字](https://…)）" onclick={addLink}>🔗 リンク</button>
		<button type="button" class="tb" onclick={() => insert('\n- 項目\n- 項目\n')}>リスト</button>
		<button type="button" class="tb" onclick={() => insert('\n| 列1 | 列2 |\n|---|---|\n| 内容 | 内容 |\n')}>表</button>
		{#if moreButton}
			<button type="button" class="tb text-sky-700" title="ここより前の文章を、取引先ページのプラン一覧に紹介文として出します（区切りは表示されません）" onclick={() => insert(`\n${MORE_MARKER}\n`)}>✂ ここまで一覧に表示</button>
		{/if}
		{#if photos.length > 0}
			<button type="button" class="tb" onclick={() => (showPicker = !showPicker)}>📷 写真挿入</button>
		{/if}
		{#if templates.length > 0}
			<button type="button" class="tb" onclick={() => (showTemplates = !showTemplates)}>テンプレート ▾</button>
		{/if}
		{#each variables as v}
			<button type="button" class="tb text-accent-600" onclick={() => insert(`{${v}}`)}>{'{'}{v}{'}'}</button>
		{/each}
		<div class="ml-auto flex gap-1 lg:hidden">
			<button type="button" class="tb {mobileTab === 'edit' ? 'bg-stone-200' : ''}" onclick={() => (mobileTab = 'edit')}>編集</button>
			<button type="button" class="tb {mobileTab === 'preview' ? 'bg-stone-200' : ''}" onclick={() => (mobileTab = 'preview')}>プレビュー</button>
		</div>
	</div>
	{#if showTemplates}
		<div class="flex flex-wrap gap-1.5 border-b border-stone-200 bg-stone-50 p-2">
			{#each templates as t (t.id)}
				<button
					type="button"
					class="rounded-full border px-3 py-1 text-xs {t.kind === 'perk' ? 'border-teal-600 text-teal-700' : 'border-stone-300 text-stone-700'} hover:bg-white"
					onclick={() => {
						insert(`
${templateToken(t.key)}
`);
						showTemplates = false;
					}}
				>{t.title}{t.kind === 'perk' ? '（特典バナー）' : ''}</button>
			{/each}
			<a href="/admin/plans/templates" class="ml-auto self-center text-xs text-stone-500 underline">テンプレートを編集</a>
		</div>
	{/if}
	{#if showPicker}
		<div class="flex gap-2 overflow-x-auto border-b border-stone-200 bg-stone-50 p-2">
			{#each photos as p}
				<button
					type="button"
					class="shrink-0"
					onclick={() => {
						insert(`![${p.caption}](${p.url})`);
						showPicker = false;
					}}
				>
					<img src={p.url} alt={p.caption} class="h-16 w-24 rounded object-cover ring-1 ring-stone-300 hover:ring-accent-500" />
				</button>
			{/each}
		</div>
	{/if}
	<div class="grid lg:grid-cols-2">
		<textarea
			bind:this={textarea}
			bind:value
			{name}
			{rows}
			class="w-full resize-y border-stone-200 p-3 font-mono text-sm focus:outline-none lg:border-r {mobileTab === 'preview' ? 'hidden lg:block' : ''}"
			placeholder="Markdown で本文を入力…"
		></textarea>
		<div class="max-h-[480px] overflow-y-auto bg-stone-50/50 p-3 text-sm {mobileTab === 'edit' ? 'hidden lg:block' : ''}">
			{#if value.trim()}
				<MarkdownView source={previewText} />
				{#if preview.perks.length}
					<p class="mt-3 rounded bg-teal-50 px-2 py-1.5 text-xs text-teal-800">特典バナーで表示: {preview.perks.map((p) => p.label).join('・')}（本文には出ません）</p>
				{/if}
			{:else}
				<p class="text-stone-400">プレビューがここに表示されます</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.tb {
		border-radius: 0.375rem;
		padding: 0.25rem 0.6rem;
		font-size: 0.8rem;
		color: #57534e;
	}
	.tb:hover {
		background: #f5f5f4;
	}
</style>
