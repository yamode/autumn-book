<script lang="ts">
	import MarkdownView from './MarkdownView.svelte';
	import type { Photo } from '$lib/types';

	let {
		value = $bindable(''),
		name = 'body',
		rows = 16,
		photos = [],
		variables = []
	}: { value?: string; name?: string; rows?: number; photos?: Photo[]; variables?: string[] } = $props();

	let textarea: HTMLTextAreaElement;
	let showPicker = $state(false);
	let mobileTab = $state<'edit' | 'preview'>('edit');

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
		<button type="button" class="tb font-bold" onclick={() => insert('**強調**')}>B</button>
		<button type="button" class="tb" onclick={() => insert('\n- 項目\n- 項目\n')}>リスト</button>
		<button type="button" class="tb" onclick={() => insert('\n| 列1 | 列2 |\n|---|---|\n| 内容 | 内容 |\n')}>表</button>
		{#if photos.length > 0}
			<button type="button" class="tb" onclick={() => (showPicker = !showPicker)}>📷 写真挿入</button>
		{/if}
		{#each variables as v}
			<button type="button" class="tb text-accent-600" onclick={() => insert(`{${v}}`)}>{'{'}{v}{'}'}</button>
		{/each}
		<div class="ml-auto flex gap-1 lg:hidden">
			<button type="button" class="tb {mobileTab === 'edit' ? 'bg-stone-200' : ''}" onclick={() => (mobileTab = 'edit')}>編集</button>
			<button type="button" class="tb {mobileTab === 'preview' ? 'bg-stone-200' : ''}" onclick={() => (mobileTab = 'preview')}>プレビュー</button>
		</div>
	</div>
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
				<MarkdownView source={value} />
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
