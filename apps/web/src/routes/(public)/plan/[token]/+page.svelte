<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDateLong } from '$lib/format';

	let { data } = $props();
	// 無効なリンク／販売していない（停止中・販売開始前・期間終了）で文言を分ける（v0.229.0）
	const title = $derived(data.state === 'invalid' ? m.plan_link_invalid_title() : m.plan_link_unavailable_title());
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-xl px-4 py-16 text-center">
	<h1 class="font-display text-2xl text-brand-900">{title}</h1>
	<p class="mt-3 text-sm text-stone-600">
		{#if data.state === 'invalid'}
			{m.plan_link_invalid_body()}
		{:else if data.state === 'before' && data.bookingStart}
			{m.plan_link_before_body({ date: formatDateLong(data.bookingStart) })}
		{:else if data.state === 'ended'}
			{m.plan_link_ended_body()}
		{:else}
			{m.plan_link_off_body()}
		{/if}
	</p>
	<p class="mt-6 flex flex-wrap justify-center gap-2">
		{#if data.state !== 'invalid' && data.plansHref}
			<a href={data.plansHref} class="inline-block rounded-lg bg-brand-800 px-5 py-2 text-sm text-white hover:bg-brand-700">{m.plan_link_other_plans({ facility: data.facilityName ?? '' })}</a>
		{/if}
		<a href="/" class="inline-block rounded-lg border border-stone-300 px-5 py-2 text-sm text-stone-700 hover:bg-stone-50">{m.plan_link_invalid_top()}</a>
	</p>
</div>
