<script lang="ts">
	// ③ 貸切風呂（任意）。空き枠の確認・予約・取消は既存の /r/bath。ここは導線と予約済みの枠の表示だけ。
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { slashDate } from '$lib/precheckin';

	let { data } = $props();
	const bath = $derived(data.bath);
	const goBath = $derived(localizeHref('/ci/go') + '?to=bath');
</script>

<section class="rounded-2xl bg-white p-5 text-sm shadow-sm">
	<h2 class="text-base font-semibold">{m.ci_step_bath()}</h2>
	<p class="mt-2 leading-relaxed">{m.ci_bath_lead()}</p>

	{#if bath.state === 'ready'}
		<h3 class="mt-4 text-xs font-semibold text-stone-500">{m.ci_bath_mine()}</h3>
		{#if bath.rows.length}
			<ul class="mt-1 divide-y divide-stone-100">
				{#each bath.rows as row (row.key)}
					<li class="flex items-center justify-between py-1.5">
						<span>{slashDate(row.date)}{#if row.bathName}<span class="ml-1 text-stone-500">{row.bathName}</span>{/if}</span>
						<span class="font-medium">{row.from}{row.to ? `–${row.to}` : ''}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="mt-1 text-stone-500">{m.ci_bath_none()}</p>
		{/if}
		<a href={goBath} class="mt-4 block w-full rounded-xl bg-stone-900 py-3 text-center text-sm font-medium text-white">
			{bath.rows.length ? m.ci_bath_change() : m.ci_bath_reserve()}
		</a>
		<p class="mt-2 text-xs leading-relaxed text-stone-500">{m.ci_bath_note()}</p>
	{:else}
		<p class="mt-4 rounded-lg bg-stone-50 px-3 py-2 leading-relaxed text-stone-700 ring-1 ring-stone-200">
			{bath.state === 'not_answered'
				? m.ci_bath_not_answered()
				: bath.state === 'not_yet'
					? m.ci_bath_not_yet()
					: bath.state === 'closed'
						? m.ci_bath_closed()
						: m.ci_bath_unavailable()}
		</p>
		{#if bath.state === 'closed'}
			<a href={goBath} class="mt-4 block w-full rounded-xl bg-white py-3 text-center text-sm text-stone-700 ring-1 ring-stone-300">{m.ci_bath_reserve()}</a>
		{/if}
	{/if}
</section>

<div class="mt-4 flex gap-3">
	<a href={localizeHref('/ci/meals')} class="flex-1 rounded-xl bg-white py-3 text-center text-sm text-stone-700 ring-1 ring-stone-300">{m.ci_back()}</a>
	{#if bath.state !== 'not_answered'}
		<a href={localizeHref('/ci/done')} class="flex-[2] rounded-xl bg-stone-900 py-3 text-center text-sm font-medium text-white">{m.ci_next()}</a>
	{/if}
</div>
