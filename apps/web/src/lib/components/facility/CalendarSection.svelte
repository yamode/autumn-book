<script lang="ts">
	import type { CalendarDay } from '$lib/types';
	import PriceCalendar from '$lib/components/PriceCalendar.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		calendar,
		calMonth,
		base
	}: { calendar: CalendarDay[]; calMonth: string; base: string } = $props();

	function shiftMonth(ym: string, delta: number): string {
		const [y, mo] = ym.split('-').map(Number);
		const d = new Date(y, mo - 1 + delta, 1);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}
</script>

{#if calendar.length > 0}
	<section>
		<h2 class="font-display mb-1 text-2xl" style="color: var(--fac-heading, #1f1d15)">{m.facility_calendar()}</h2>
		<p class="mb-4 text-sm text-stone-500">{m.facility_calendar_sub()}</p>
		<div class="max-w-xl">
			<PriceCalendar
				days={calendar}
				yearMonth={calMonth}
				makeDayHref={(date) => `${base}/plans?checkin=${date}&nights=1&adults=2`}
				prevHref="{base}?cal={shiftMonth(calMonth, -1)}#cal"
				nextHref="{base}?cal={shiftMonth(calMonth, 1)}#cal"
			/>
		</div>
	</section>
{/if}
