<script lang="ts">
	// ④ 完了。選んだ食事の時間と、③ で取った貸切風呂の予約をまとめて出し、利用案内（客室案内 /r）へ案内する。
	// 利用案内のリンクは /ci/go を通す: 回答済みなら滞在トークンを Cookie（ab_stay）に入れてから移るので、6 桁コードを入れずに開ける。
	// 貸切風呂を取ってあれば「予約する」は出さない（③ と重複するため）。取っていなければ ③ へ戻る小さなリンクだけ（2026-11-14）。
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { slashDate, type PcMealType } from '$lib/precheckin';

	let { data } = $props();
	const ctx = $derived(data.ctx!);
	const types: PcMealType[] = ['dinner', 'breakfast'];
	const rows = $derived(
		ctx.rooms.flatMap((r) =>
			r.nights.flatMap((n) =>
				types
					.filter((t) => n[t].offered)
					.map((t) => ({ key: `${n.stayId}|${t}|${n[t].date}`, room: r.index, type: t, date: n[t].date, time: n[t].time }))
			)
		)
	);
	const bathRows = $derived(data.bathRows ?? []);
</script>

<section class="rounded-2xl bg-white p-5 text-sm shadow-sm">
	<h2 class="text-base font-semibold">{m.ci_done_title()}</h2>

	{#if rows.length}
		<h3 class="mt-4 text-xs font-semibold text-stone-500">{m.ci_done_meals()}</h3>
		<ul class="mt-1 divide-y divide-stone-100">
			{#each rows as row (row.key)}
				<li class="flex items-center justify-between py-1.5">
					<span>
						{#if ctx.rooms.length > 1}<span class="mr-1 text-stone-500">{m.ci_room_n({ n: String(row.room) })}</span>{/if}
						{slashDate(row.date)} {row.type === 'dinner' ? m.ci_dinner() : m.ci_breakfast()}
					</span>
					<span class="font-medium">{row.time ?? '—'}</span>
				</li>
			{/each}
		</ul>
	{/if}

	<h3 class="mt-4 text-xs font-semibold text-stone-500">{m.ci_step_bath()}</h3>
	{#if bathRows.length}
		<ul class="mt-1 divide-y divide-stone-100">
			{#each bathRows as r (r.key)}
				<li class="flex items-center justify-between py-1.5">
					<span>{slashDate(r.date)}{#if r.bathName}<span class="ml-1 text-stone-500">{r.bathName}</span>{/if}</span>
					<span class="font-medium">{r.from}{r.to ? `–${r.to}` : ''}</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-1 text-stone-500">
			{m.ci_bath_none()}
			<a href={localizeHref('/ci/bath')} class="ml-1 text-stone-700 underline">{m.ci_bath_reserve()}</a>
		</p>
	{/if}

	{#if ctx.editable}
		<a href={localizeHref('/ci')} class="mt-4 inline-block text-sm text-stone-600 underline">{m.ci_done_edit()}</a>
	{/if}
</section>

<a href={`${localizeHref('/ci/go')}?to=inroom`} class="mt-4 block w-full rounded-xl bg-stone-900 py-3 text-center text-sm font-medium text-white">{m.ci_done_inroom()}</a>

<p class="mt-4 text-center text-xs text-stone-500">{slashDate(ctx.checkIn)} · {ctx.facility.name}</p>
