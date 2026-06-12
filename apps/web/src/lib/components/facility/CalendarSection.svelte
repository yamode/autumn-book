<script lang="ts">
	import type { CalendarDay } from '$lib/types';
	import type { CalendarMonthRange } from '$lib/calendar-range';
	import PriceCalendar from '$lib/components/PriceCalendar.svelte';
	import { shiftYearMonth } from '$lib/calendar-range';
	import * as m from '$lib/paraglide/messages';

	let {
		calendar,
		calMonth,
		base,
		calendarNav
	}: { calendar: CalendarDay[]; calMonth: string; base: string; calendarNav: CalendarMonthRange } = $props();
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
				prevHref={calendarNav.canGoPrev ? `${base}?cal=${shiftYearMonth(calMonth, -1)}#cal` : null}
				nextHref={calendarNav.canGoNext ? `${base}?cal=${shiftYearMonth(calMonth, 1)}#cal` : null}
			/>
		</div>
	</section>
{/if}
