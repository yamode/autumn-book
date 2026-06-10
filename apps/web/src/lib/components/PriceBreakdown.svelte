<script lang="ts">
	import type { Quote } from '@autumn-book/core';
	import { formatPrice, formatDate } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	let { quote, showLines = true }: { quote: Quote; showLines?: boolean } = $props();
</script>

<div class="space-y-1.5 text-sm">
	{#if showLines}
		{#each quote.lines as line}
			<div class="flex justify-between text-stone-600">
				<span>{m.price_breakdown_line({ date: formatDate(line.date), adults: String(line.adults), unit: formatPrice(line.unitPrice) })}</span>
				<span>{formatPrice(line.subtotal)}</span>
			</div>
		{/each}
	{/if}
	<div class="flex justify-between border-t border-stone-200 pt-1.5 font-medium">
		<span>{m.price_breakdown_total()}</span>
		<span class="text-lg">{formatPrice(quote.total)}</span>
	</div>
	<div class="flex justify-between text-xs text-stone-400">
		<span>{m.price_breakdown_tax()}</span>
		<span>{formatPrice(quote.taxIncluded)}</span>
	</div>
	{#if quote.pointsUsed > 0}
		<div class="flex justify-between text-emerald-700">
			<span>{m.price_breakdown_points()}</span>
			<span>-{formatPrice(quote.pointsUsed).slice(1)}{m.common_point_unit()}</span>
		</div>
		<div class="flex justify-between border-t border-stone-200 pt-1.5 text-base font-bold">
			<span>{m.price_breakdown_payable()}</span>
			<span>{formatPrice(quote.payable)}</span>
		</div>
	{/if}
</div>
