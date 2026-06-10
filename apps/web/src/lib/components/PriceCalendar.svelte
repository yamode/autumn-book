<script lang="ts">
	import type { CalendarDay } from '$lib/types';
	import { formatYen } from '$lib/format';

	let {
		days,
		yearMonth,
		makeDayHref,
		prevHref,
		nextHref
	}: {
		days: CalendarDay[];
		yearMonth: string; // YYYY-MM
		makeDayHref: (date: string) => string;
		prevHref: string;
		nextHref: string;
	} = $props();

	const [y, m] = yearMonth.split('-').map(Number);
	const firstDow = new Date(y, m - 1, 1).getDay();
	const dows = ['日', '月', '火', '水', '木', '金', '土'];
</script>

<div class="rounded-xl border border-stone-200 bg-white p-4">
	<div class="mb-3 flex items-center justify-between">
		<a href={prevHref} class="rounded px-2 py-1 text-sm text-stone-500 hover:bg-stone-100">← 前月</a>
		<p class="font-medium">{y}年{m}月</p>
		<a href={nextHref} class="rounded px-2 py-1 text-sm text-stone-500 hover:bg-stone-100">翌月 →</a>
	</div>
	<div class="grid grid-cols-7 gap-1 text-center text-xs">
		{#each dows as d, i}
			<div class="py-1 font-medium {i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-stone-500'}">{d}</div>
		{/each}
		{#each Array(firstDow) as _}
			<div></div>
		{/each}
		{#each days as day}
			{@const dayNum = Number(day.date.slice(-2))}
			{#if day.price === null}
				<div class="flex flex-col items-center rounded-md border border-stone-100 bg-stone-50 py-1.5 text-stone-300">
					<span>{dayNum}</span>
					<span class="text-[10px]">{day.mark}</span>
				</div>
			{:else}
				<a
					href={makeDayHref(day.date)}
					class="flex flex-col items-center rounded-md border border-stone-200 py-1.5 transition hover:border-accent-500 hover:bg-amber-50"
				>
					<span class="font-medium">{dayNum}</span>
					<span class="text-[10px] {day.mark === '△' ? 'text-red-600' : 'text-emerald-700'}">{day.mark}</span>
					<span class="text-[10px] text-stone-600">{formatYen(day.price).replace('¥', '')}</span>
				</a>
			{/if}
		{/each}
	</div>
	<p class="mt-3 text-xs text-stone-400">◎○=空室あり △=残りわずか ×=満室 ／ 料金は大人1名1泊（税込）</p>
</div>
