<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';

	let { data } = $props();
	const localeTag: Record<string, string> = { ja: 'ja-JP', en: 'en-US', 'zh-TW': 'zh-TW' };
	const dateLabel = $derived(
		new Intl.DateTimeFormat(localeTag[getLocale()] ?? 'ja-JP', {
			year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo'
		}).format(new Date(`${data.reservation.date}T00:00:00+09:00`))
	);
</script>

<svelte:head><title>{m.bath_step3()} ｜ YAMADO</title></svelte:head>

<div class="px-4 py-6">
	<section class="rounded-lg bg-white px-5 py-8 shadow-card">
		<div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#eaf1ed] text-[#405a4c]" aria-hidden="true">
			<svg viewBox="0 0 24 24" class="h-8 w-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7" /></svg>
		</div>
		<h1 class="mt-5 text-center text-lg font-semibold text-stone-900">{m.bath_step3()}</h1>
		<p class="mt-3 whitespace-pre-line text-center text-sm leading-6 text-stone-700">{data.content.fields.done || m.bath_done()}</p>

		<dl class="mt-7 divide-y divide-stone-100 rounded-lg border border-stone-200 px-4 text-sm">
			<div class="flex justify-between gap-3 py-3"><dt class="text-stone-500">{m.bath_room()}</dt><dd class="font-medium text-stone-900">{data.ctx.room_code}</dd></div>
			{#if data.bathName}<div class="flex justify-between gap-3 py-3"><dt class="text-stone-500">{m.bath_field_bath()}</dt><dd class="text-right font-medium text-stone-900">{data.bathName}</dd></div>{/if}
			<div class="flex justify-between gap-3 py-3"><dt class="text-stone-500">{m.bath_label_date()}</dt><dd class="text-right font-medium text-stone-900">{dateLabel}</dd></div>
			<div class="flex justify-between gap-3 py-3"><dt class="text-stone-500">{m.bath_label_time()}</dt><dd class="font-medium tabular-nums text-stone-900">{data.reservation.from}{data.reservation.to ? `〜${data.reservation.to}` : ''}</dd></div>
		</dl>

		<div class="mt-7 space-y-3">
			<a href="/r" class="flex min-h-12 items-center justify-center rounded bg-[#48575f] px-4 text-center text-sm font-medium text-white">{m.bath_back()}</a>
			<a href="/r/bath#new-reservation" class="flex min-h-12 items-center justify-center rounded border border-[#48575f] px-4 text-center text-sm font-medium text-[#48575f]">{m.bath_new()}</a>
		</div>
	</section>
</div>
