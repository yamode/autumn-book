<script lang="ts">
	import type { Snippet } from 'svelte';

	// KPI カード。level で左ボーダーの色を変える（ok/warn/error）。
	let {
		label,
		value,
		sub = null,
		level = 'ok',
		children
	}: {
		label: string;
		value: string;
		sub?: string | null;
		level?: 'ok' | 'warn' | 'error';
		children?: Snippet;
	} = $props();

	const border = {
		ok: 'border-l-emerald-500',
		warn: 'border-l-amber-500',
		error: 'border-l-red-500'
	};
</script>

<div class="rounded-xl border border-l-4 border-stone-200 bg-white p-4 {border[level]}">
	<p class="text-xs text-stone-500">{label}</p>
	<p class="mt-1 text-2xl font-bold text-stone-800">{value}</p>
	{#if sub}<p class="mt-0.5 text-xs text-stone-400">{sub}</p>{/if}
	{#if children}{@render children()}{/if}
</div>
