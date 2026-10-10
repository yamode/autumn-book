<script lang="ts">
	import type { Quote, QuoteLine } from '@autumn-book/core';
	import { formatPrice, formatNightDate } from '$lib/format';
	import { nightGroups } from '$lib/multi-room';
	import * as m from '$lib/paraglide/messages';

	// quote: 合計（複数室は全室の和）。rooms: 部屋ごとの泊の明細（省略時は quote.lines を 1 室として出す）
	let { quote, rooms, showLines = true }: { quote: Quote; rooms?: { lines: QuoteLine[] }[]; showLines?: boolean } = $props();

	// 料金の明細は「泊ごとの見出し → その下に部屋ごとの行」（2026-10-10 指示）。1 室は行の「1室目」を省く・1 泊でも見出しを出す
	let groups = $derived(nightGroups(rooms && rooms.length > 0 ? rooms : [{ lines: quote.lines }]));
	let multi = $derived((rooms?.length ?? 1) > 1);
</script>

<div class="space-y-1.5 text-sm">
	{#if showLines}
		{#each groups as g (g.date)}
			<div>
				<p class="text-xs font-medium text-stone-500">{m.price_night_heading({ n: String(g.night), date: formatNightDate(g.date) })}</p>
				{#each g.rows as r (r.room)}
					<div class="flex justify-between gap-2 pl-3 text-stone-600">
						<span class="min-w-0">
							{multi
								? m.price_night_room_row({ room: String(r.room + 1), unit: formatPrice(r.unitPrice), adults: String(r.adults) })
								: m.price_night_row({ unit: formatPrice(r.unitPrice), adults: String(r.adults) })}
						</span>
						<span class="whitespace-nowrap tabular-nums">{formatPrice(r.subtotal)}</span>
					</div>
				{/each}
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
