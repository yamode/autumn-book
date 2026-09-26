<script lang="ts">
	import ContentEditor from '$lib/components/admin/ContentEditor.svelte';

	let { data } = $props();
	let r = $derived(data.room);
</script>

<svelte:head><title>{r.name} ｜ 部屋編集 ｜ 山人管理</title></svelte:head>

<nav class="mb-3 text-xs text-stone-400"><a href="/admin/rooms" class="hover:underline">部屋編集</a> / {r.name}</nav>

<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-lg font-bold text-stone-800">{r.name}</h1>
		<p class="text-xs text-stone-400">
			{r.code}{r.capacityMax ? `・定員${r.capacityMin ?? 1}〜${r.capacityMax}名` : ''}{r.isActive ? '' : '・PMS で無効（公開しても表示されません）'}
			{#if !r.hasContent}・紹介はまだ作られていません（保存すると作成されます）{/if}
		</p>
	</div>
	{#if data.previewBase && r.slug && r.isPublished}
		<a href="{data.previewBase}/rooms/{r.slug}" target="_blank" class="rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50">公開ページを開く ↗</a>
	{/if}
</div>

{#key r.updatedAt}
	<ContentEditor
		initial={r}
		kind="room"
		live={data.live}
		tagsLabel="特徴タグ（「、」区切り）"
		tagsPlaceholder="温泉、テラス付、禁煙"
		photoFallback="room"
	/>
{/key}
