<script lang="ts">
	// 全館の湯量の残量目安（客室案内のトップ・ヒーロー直下。2026-10-17・西和賀で使う）。
	// 値はスタッフが管理画面（/admin/inroom）で手入力する。ⓘ を押す（PC はかざす）と、何を表しているかを出す。
	// 説明は管理画面で書き換えられる（日本語）。空のとき・日本語以外では既定文を出す。
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { SPRING_TONE_BAR, springBandFor, springBandLabel, type SpringBand } from '$lib/spring-level';

	let {
		percent,
		note = '',
		updatedAt = null,
		bands = null
	}: { percent: number; note?: string; updatedAt?: string | null; bands?: SpringBand[] | null } = $props();

	let open = $state(false);
	// 説明を一度でも開いた端末か（開くまで波紋を出す・localStorage が使えなければ毎回出す）
	const SEEN_KEY = 'ab_spring_tip_seen';
	let seen = $state(true);
	$effect(() => {
		try {
			seen = localStorage.getItem(SEEN_KEY) === '1';
		} catch {
			seen = false;
		}
	});
	function markSeen() {
		if (seen) return;
		seen = true;
		try {
			localStorage.setItem(SEEN_KEY, '1');
		} catch {
			// 保存できない端末は、このページを開いている間だけ止める
		}
	}
	let hovered = false;
	let wrap = $state<HTMLElement | null>(null);

	const level = $derived(Math.max(0, Math.min(100, Math.round(percent))));
	// 目安の言葉と色（施設ごとに管理画面で決めた段階・無ければ既定。$lib/spring-level.ts）
	const band = $derived(springBandFor(level, bands));
	const stateLabel = $derived(springBandLabel(band, getLocale()));
	const barColor = $derived(SPRING_TONE_BAR[band.tone]);
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

<!-- 控えめな帯（2026-10-17 指示）。帯は全幅、中身は1カラムで中央の8割幅（見出し行の下に細いバー）。更新時刻は ⓘ の説明に入れる -->
<section class="border-b border-stone-100 bg-white py-2.5" aria-labelledby="spring-level-title">
	<div class="mx-auto w-4/5">
	<div class="flex items-center justify-between gap-3">
		<div class="relative flex shrink-0 items-center gap-1" bind:this={wrap}>
			<svg viewBox="0 0 24 24" class="h-3.5 w-3.5 shrink-0 text-stone-400" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
			</svg>
			<h2 id="spring-level-title" class="whitespace-nowrap text-xs text-stone-500">{m.spring_level_title()}</h2>
			<button
				type="button"
				class="relative ml-0.5 flex h-7 w-7 items-center justify-center rounded-full"
				aria-label={m.spring_level_info_label()}
				aria-expanded={open}
				aria-describedby={open ? 'spring-level-tip' : undefined}
				onclick={() => {
					// マウスでかざして開いているときは、押しても閉じない（タップは押すたびに開閉）
					open = hovered ? true : !open;
					markSeen();
				}}
				onpointerenter={(e) => {
					if (e.pointerType !== 'mouse') return;
					hovered = true;
					open = true;
					markSeen();
				}}
				onpointerleave={(e) => {
					if (e.pointerType !== 'mouse') return;
					hovered = false;
					open = false;
				}}
			>
				<!-- タップしたくなる目印（2026-10-17 指示）。塗りの丸に「?」。まだ開いたことのない端末は、淡い波紋で誘う -->
				{#if !seen}<span class="absolute inset-1 animate-ping rounded-full bg-sky-400/40" aria-hidden="true"></span>{/if}
				<span class="relative flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-[11px] font-bold leading-none text-white shadow-sm ring-2 ring-sky-100" aria-hidden="true">?</span>
			</button>
			{#if open}
				<div
					id="spring-level-tip"
					role="tooltip"
					class="absolute left-0 top-full z-30 mt-1 w-[min(18rem,calc(100vw-2.5rem))] rounded-lg bg-stone-900 px-3 py-2.5 text-xs leading-relaxed text-white shadow-lg"
				>
					<span class="whitespace-pre-line">{tip}</span>
					{#if updatedLabel}<span class="mt-1.5 block text-stone-400">{updatedLabel}</span>{/if}
				</div>
			{/if}
		</div>
		<p class="min-w-0 text-right text-xs leading-snug text-stone-500">
			<span class="font-medium tabular-nums text-stone-700">{level}%</span>
			<span class="ml-1 inline-block">{stateLabel}</span>
		</p>
	</div>
		<div
			class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-100"
			role="meter"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={level}
			aria-labelledby="spring-level-title"
		>
			<div class={`h-full rounded-full ${barColor} transition-[width]`} style={`width:${level}%`}></div>
		</div>
	</div>
</section>
