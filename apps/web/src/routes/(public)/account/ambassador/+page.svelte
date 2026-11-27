<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDateLong } from '$lib/format';

	let { data } = $props();
	const a = $derived(data.ambassador);
	let copied = $state<'' | 'code' | 'url'>('');

	async function copy(text: string, what: 'code' | 'url') {
		try {
			await navigator.clipboard.writeText(text);
			copied = what;
			setTimeout(() => (copied = ''), 2000);
		} catch {
			/* コピーできない端末は手で選んでもらう */
		}
	}

	const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
	async function share() {
		try {
			await navigator.share({ title: m.ambassador_share_title(), text: m.ambassador_share_text({ code: a.code }), url: data.url });
		} catch {
			/* 閉じただけ */
		}
	}
</script>

<svelte:head><title>{m.ambassador_title()}</title></svelte:head>

<section class="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
	<p class="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">{m.ambassador_badge()}</p>
	<h2 class="mt-2 text-lg font-semibold text-brand-900">{m.ambassador_heading()}</h2>
	<p class="mt-1 text-sm leading-relaxed text-stone-600">{m.ambassador_lead()}</p>

	<div class="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
		<div class="space-y-3">
			<div>
				<p class="text-xs text-stone-500">{m.ambassador_code_label()}</p>
				<div class="mt-1 flex flex-wrap items-center gap-2">
					<span class="rounded-lg bg-white px-3 py-2 font-mono text-xl tracking-[0.2em] text-brand-900">{a.code}</span>
					<button type="button" onclick={() => copy(a.code, 'code')} class="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm">{copied === 'code' ? m.ambassador_copied() : m.ambassador_copy()}</button>
				</div>
			</div>
			<div>
				<p class="text-xs text-stone-500">{m.ambassador_url_label()}</p>
				<div class="mt-1 flex flex-wrap items-center gap-2">
					<span class="min-w-0 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-stone-700">{data.url}</span>
					<button type="button" onclick={() => copy(data.url, 'url')} class="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm">{copied === 'url' ? m.ambassador_copied() : m.ambassador_copy()}</button>
					{#if canShare}
						<button type="button" onclick={share} class="min-h-11 rounded-lg bg-brand-800 px-4 text-sm font-medium text-white">{m.ambassador_share()}</button>
					{/if}
				</div>
			</div>
		</div>
		<svg viewBox="0 0 {data.qr.size} {data.qr.size}" class="h-36 w-36 justify-self-center rounded-lg bg-white" role="img" aria-label={m.ambassador_qr_label()}>
			<path d={data.qr.path} fill="#1c1917" />
		</svg>
	</div>
</section>

<section class="mt-5 rounded-2xl border border-stone-200 bg-white p-5">
	<h2 class="text-base font-semibold">{m.ambassador_stats_heading()}</h2>
	<dl class="mt-3 grid grid-cols-3 gap-3 text-center">
		<div class="rounded-xl bg-stone-50 p-3"><dt class="text-xs text-stone-500">{m.ambassador_stat_stayed()}</dt><dd class="mt-1 text-2xl font-semibold text-brand-900">{a.stayed}</dd></div>
		<div class="rounded-xl bg-stone-50 p-3"><dt class="text-xs text-stone-500">{m.ambassador_stat_visits()}</dt><dd class="mt-1 text-2xl font-semibold text-brand-900">{a.visits}</dd></div>
		<div class="rounded-xl bg-stone-50 p-3"><dt class="text-xs text-stone-500">{m.ambassador_stat_points()}</dt><dd class="mt-1 text-2xl font-semibold text-emerald-800">{a.pointsTotal.toLocaleString()}</dd></div>
	</dl>
	<p class="mt-2 text-xs text-stone-500">{m.ambassador_stat_registered({ count: a.registered })}</p>
	<p class="mt-3 text-xs leading-relaxed text-stone-500">
		{m.ambassador_reward_note({ points: a.firstPoints.toLocaleString() })}
		{#if a.shareRates.length}{m.ambassador_reward_share({ rates: a.shareRates.map((r, i) => m.ambassador_reward_year({ year: i + 1, rate: r })).join(' / ') })}{/if}
	</p>

	{#if a.referrals.length}
		<h3 class="mt-5 text-sm font-semibold">{m.ambassador_list_heading()}</h3>
		<ul class="mt-2 divide-y divide-stone-100 text-sm">
			{#each a.referrals as r, i (i)}
				<li class="flex flex-wrap items-center justify-between gap-2 py-2.5">
					<span class="font-medium">{r.label}</span>
					<span class="text-xs text-stone-500">
						{#if r.status === 'ineligible'}
							{m.ambassador_list_ineligible()}
						{:else if r.visits > 0 && r.firstStayOn}
							{m.ambassador_list_stayed({ date: formatDateLong(r.firstStayOn), visits: r.visits })}
						{:else}
							{m.ambassador_list_registered({ date: formatDateLong(r.registeredOn) })}
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 text-sm text-stone-500">{m.ambassador_list_empty()}</p>
	{/if}
</section>
