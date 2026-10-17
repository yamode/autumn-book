<script lang="ts">
	// 状態カード（2026-10-17 モダン化・客室案内の「きょうの運用」）。いまの状態をひと目で見せ、操作へ案内する。
	// tone: on＝出している・表示中（緑）／off＝出していない（灰）／warn＝気をつける（黄）
	import AdminIcon, { type AdminIconName } from './AdminIcon.svelte';
	let {
		icon,
		title,
		status = null,
		tone = 'off',
		detail = null,
		href,
		action
	}: { icon: AdminIconName; title: string; status?: string | null; tone?: 'on' | 'off' | 'warn'; detail?: string | null; href: string; action: string } = $props();
	const TONE = { on: 'bg-emerald-50 text-emerald-800 ring-emerald-200', off: 'bg-stone-50 text-stone-500 ring-stone-200', warn: 'bg-amber-50 text-amber-800 ring-amber-200' };
	const DOT = { on: 'bg-emerald-500', off: 'bg-stone-300', warn: 'bg-amber-500' };
</script>

<a href={href} class="group flex min-w-0 flex-col rounded-xl border border-stone-200 bg-white p-3 transition hover:border-stone-300 hover:shadow-sm sm:p-4">
	<div class="flex flex-col items-start gap-2 sm:flex-row sm:gap-2.5">
		<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600 sm:h-9 sm:w-9"><AdminIcon name={icon} class="h-[18px] w-[18px]" /></span>
		<div class="min-w-0 flex-1">
			<p class="text-sm leading-snug font-medium text-stone-800 sm:text-base">{title}</p>
			{#if status}
				<span class="mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset {TONE[tone]}">
					<span class="h-1.5 w-1.5 rounded-full {DOT[tone]}"></span>{status}
				</span>
			{/if}
		</div>
	</div>
	{#if detail}<p class="mt-2.5 line-clamp-2 text-xs leading-relaxed text-stone-500">{detail}</p>{/if}
	<span class="mt-auto flex items-center gap-1 pt-3 text-xs font-medium text-brand-800 group-hover:text-brand-700">
		{action}<AdminIcon name="chevron" class="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
	</span>
</a>
