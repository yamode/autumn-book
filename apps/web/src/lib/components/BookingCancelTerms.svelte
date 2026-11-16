<script lang="ts">
	import { addDays, formatDateLong } from '$lib/format';
	import * as m from '$lib/paraglide/messages';
	import type { CancellationPolicy } from '@autumn-book/core';

	let { policy, checkin }: { policy: CancellationPolicy; checkin?: string } = $props();
	let rules = $derived(policy.rules.filter((rule) => rule.rate > 0).sort((a, b) => b.days_before - a.days_before));
	let freeUntil = $derived(rules.length ? rules[0].days_before + 1 : null);
	let untilDate = $derived(checkin && freeUntil !== null ? formatDateLong(addDays(checkin, -freeUntil)) : '');

	function label(days: number) {
		if (days < 0) return m.booking_cancel_no_show();
		if (days === 0) return m.booking_cancel_same_day();
		if (days === 1) return m.booking_cancel_previous_day();
		return m.booking_cancel_days({ days: String(days) });
	}
</script>

{#if freeUntil === null}
	<p class="font-semibold">{m.booking_cancel_free()}</p>
{:else}
	<p class="font-semibold">{untilDate
		? m.booking_cancel_free_date({ date: untilDate })
		: m.booking_cancel_free_days({ days: String(freeUntil) })}</p>
	<dl class="mt-2 divide-y divide-stone-200">
		{#each rules as rule}
			<div class="flex items-baseline justify-between gap-3 py-1">
				<dt>{label(rule.days_before)}</dt>
				<dd class="shrink-0 font-semibold tabular-nums">{Math.round(rule.rate * 100)}%</dd>
			</div>
		{/each}
	</dl>
{/if}
