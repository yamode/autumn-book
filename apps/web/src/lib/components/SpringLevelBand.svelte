<script lang="ts">
	// 全館の湯量の残量目安（客室案内のトップ・ヒーロー直下。2026-10-17・西和賀で使う）。
	// 値はスタッフが管理画面（/admin/inroom）で手入力する。ⓘ を押す（PC はかざす）と、何を表しているかを出す。
	// 説明は管理画面で書き換えられる（日本語）。空のとき・日本語以外では既定文を出す。
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';

	let { percent, note = '', updatedAt = null }: { percent: number; note?: string; updatedAt?: string | null } = $props();

	let open = $state(false);
	let hovered = false;
	let wrap = $state<HTMLElement | null>(null);

	const level = $derived(Math.max(0, Math.min(100, Math.round(percent))));
	// 目安の言葉と色（多い・ふつう・少なめ）
	const tier = $derived(level >= 60 ? 'high' : level >= 30 ? 'mid' : 'low');
	const stateLabel = $derived(
		tier === 'high' ? m.spring_level_high() : tier === 'mid' ? m.spring_level_mid() : m.spring_level_low()
	);
	const barColor = $derived(tier === 'high' ? 'bg-sky-500' : tier === 'mid' ? 'bg-emerald-500' : 'bg-amber-500');
	const tip = $derived(getLocale() === 'ja' && note.trim() ? note.trim() : m.spring_level_default_note());

	const localeTag: Record<string, string> = { ja: 'ja-JP', en: 'en-US', 'zh-TW': 'zh-TW' };
	const updatedLabel = $derived.by(() => {
		if (!updatedAt) return '';
		try {
			const t = new Intl.DateTimeFormat(localeTag[getLocale()] ?? 'ja-JP', {
				month: 'numeric',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				timeZone: 'Asia/Tokyo'
			}).format(new Date(updatedAt));
			return m.spring_level_updated({ time: t });
		} catch {
			return '';
		}
	});

	// 吹き出しの外を押したら閉じる
	$effect(() => {
		if (!open) return;
		const onDown = (e: PointerEvent) => {
			if (wrap && !wrap.contains(e.target as Node)) open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
		};
		document.addEventListener('pointerdown', onDown);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onDown);
			document.removeEventListener('keydown', onKey);
		};
	});
</script>

<section class="border-b border-stone-100 bg-white px-5 py-4" aria-labelledby="spring-level-title">
	<div class="flex items-center justify-between gap-3">
		<div class="relative flex items-center gap-1.5" bind:this={wrap}>
			<svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0 text-sky-700" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
			</svg>
			<h2 id="spring-level-title" class="text-[15px] font-semibold text-stone-900">{m.spring_level_title()}</h2>
			<button
				type="button"
				class="flex h-6 w-6 items-center justify-center rounded-full text-stone-400 hover:text-stone-700"
				aria-label={m.spring_level_info_label()}
				aria-expanded={open}
				aria-describedby={open ? 'spring-level-tip' : undefined}
				onclick={() => {
					// マウスでかざして開いているときは、押しても閉じない（タップは押すたびに開閉）
					open = hovered ? true : !open;
				}}
				onpointerenter={(e) => {
					if (e.pointerType !== 'mouse') return;
					hovered = true;
					open = true;
				}}
				onpointerleave={(e) => {
					if (e.pointerType !== 'mouse') return;
					hovered = false;
					open = false;
				}}
			>
				<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
					<circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.6" r="0.6" fill="currentColor" />
				</svg>
			</button>
			{#if open}
				<div
					id="spring-level-tip"
					role="tooltip"
					class="absolute left-0 top-full z-30 mt-2 w-[min(18rem,calc(100vw-2.5rem))] rounded-lg bg-stone-900 px-3 py-2.5 text-xs leading-relaxed text-white shadow-lg"
				>
					<span class="whitespace-pre-line">{tip}</span>
				</div>
			{/if}
		</div>
		<p class="shrink-0 text-right">
			<strong class="text-2xl font-semibold tabular-nums text-stone-900">{level}</strong><span class="ml-0.5 text-sm text-stone-500">%</span>
		</p>
	</div>
	<div
		class="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-stone-100"
		role="meter"
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={level}
		aria-labelledby="spring-level-title"
	>
		<div class={`h-full rounded-full ${barColor} transition-[width]`} style={`width:${level}%`}></div>
	</div>
	<div class="mt-1.5 flex items-baseline justify-between text-xs">
		<span class="font-medium text-stone-700">{stateLabel}</span>
		{#if updatedLabel}<span class="text-stone-400">{updatedLabel}</span>{/if}
	</div>
</section>
