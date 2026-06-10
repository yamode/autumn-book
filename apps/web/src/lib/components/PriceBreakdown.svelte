<script lang="ts">
	import type { Quote } from '@autumn-book/core';
	import { formatYen, formatDateJa } from '$lib/format';

	let { quote, showLines = true }: { quote: Quote; showLines?: boolean } = $props();
</script>

<div class="space-y-1.5 text-sm">
	{#if showLines}
		{#each quote.lines as line}
			<div class="flex justify-between text-stone-600">
				<span>{formatDateJa(line.date)} 大人{line.adults}名 × {formatYen(line.unitPrice)}</span>
				<span>{formatYen(line.subtotal)}</span>
			</div>
		{/each}
	{/if}
	<div class="flex justify-between border-t border-stone-200 pt-1.5 font-medium">
		<span>合計（税込）</span>
		<span class="text-lg">{formatYen(quote.total)}</span>
	</div>
	<div class="flex justify-between text-xs text-stone-400">
		<span>内消費税</span>
		<span>{formatYen(quote.taxIncluded)}</span>
	</div>
	{#if quote.pointsUsed > 0}
		<div class="flex justify-between text-emerald-700">
			<span>ポイント利用</span>
			<span>-{formatYen(quote.pointsUsed).slice(1)}pt</span>
		</div>
		<div class="flex justify-between border-t border-stone-200 pt-1.5 text-base font-bold">
			<span>お支払い額</span>
			<span>{formatYen(quote.payable)}</span>
		</div>
	{/if}
</div>
