<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { BathSlot } from '$lib/server/private-bath';

	let { slots }: { slots: BathSlot[] } = $props();

	const ranges = $derived.by(() => {
		const byRange = new Map<string, NonNullable<BathSlot['extra_quota']> & { open: number }>();
		for (const slot of slots) {
			if (!slot.extra_quota) continue;
			const { from, to } = slot.extra_quota;
			const key = `${from}|${to}`;
			const range = byRange.get(key) ?? { ...slot.extra_quota, open: 0 };
			if (!slot.taken && !slot.closed && !slot.limit_reached) range.open += 1;
			byRange.set(key, range);
		}
		return [...byRange.values()];
	});
</script>

{#each ranges as range (`${range.from}|${range.to}`)}
	<div class="my-2 flex flex-wrap items-baseline gap-x-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
		<span class="tabular-nums">{range.from}〜{range.to}</span>
		{#if range.open > 0}
			<strong>{m.bath_extra_remaining({ count: Math.min(range.remaining, range.open) })}</strong>
		{/if}
		<span>{m.bath_extra_usage({ booked: range.booked, limit: range.limit })}</span>
	</div>
{/each}
