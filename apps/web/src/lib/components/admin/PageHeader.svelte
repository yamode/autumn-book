<script lang="ts">
	// 管理画面の画面見出し（2026-10-17 モダン化）。見出し・施設名・説明・右側の操作をそろえる。
	// 現在地（グループ › 画面）はレイアウトが上に出すので、ここでは出さない。
	import type { Snippet } from 'svelte';
	let {
		title,
		facility = null,
		description = null,
		actions
	}: { title: string; facility?: string | null; description?: string | null; actions?: Snippet } = $props();
</script>

<div class="mb-5 flex flex-wrap items-end justify-between gap-3">
	<div class="min-w-0">
		<h1 class="text-xl font-semibold tracking-tight text-stone-900">
			{title}{#if facility}<span class="ml-2 align-middle text-sm font-normal text-stone-500">{facility}</span>{/if}
		</h1>
		{#if description}<p class="mt-1 max-w-3xl text-sm leading-relaxed text-stone-500">{description}</p>{/if}
	</div>
	{#if actions}<div class="flex shrink-0 flex-wrap items-center gap-2">{@render actions()}</div>{/if}
</div>
