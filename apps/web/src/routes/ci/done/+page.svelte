<script lang="ts">
	// ④ 完了。選んだ食事の時間と、③ で取った貸切風呂の予約をまとめて出し、利用案内（客室案内 /r）へ案内する。
	// 利用案内のリンクは /ci/go を通す: 回答済みなら滞在トークンを Cookie（ab_stay）に入れてから移るので、6 桁コードを入れずに開ける。
	// /ci/go は +server.ts だけの入口（ページが無い）なので、data-sveltekit-reload でふつうの遷移にする。付けないと画面内の遷移になって 404 になる（2026-11-15）。
	// 貸切風呂を取ってあれば「予約する」は出さない（③ と重複するため）。取っていなければ ③ へ戻る小さなリンクだけ（2026-11-14）。
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { DEMO_PRECHECKIN_CODE, slashDate, type PcMealType } from '$lib/precheckin';
	import { canBookBathInPrecheckin, ciBathBeforeDay } from '$lib/precheckin-p3';
	import { linkifyParts } from '$lib/precheckin-done-message';

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
	// 施設からのご案内（管理画面 /admin/precheckin で編集・2026-11-28）。文字として出し、URL だけリンクにする
	const noticeParts = $derived(data.notice ? linkifyParts(data.notice) : []);
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
					<span class="font-medium">{row.time ?? m.ci_meal_unset()}</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if !canBookBathInPrecheckin(ctx)}
		<p class="mt-4 text-stone-500">{m.ci_bath_inroom_only()}</p>
	{:else}
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
				{#if ctx.bookingCode !== DEMO_PRECHECKIN_CODE && ciBathBeforeDay(ctx.checkIn)}
					<!-- 事前チェックインからの貸切風呂の予約は、チェックイン当日から（2026-11-23） -->
					{m.ci_bath_before_day()}
				{:else}
					{m.ci_meal_unset()}
					<a href={localizeHref('/ci/bath')} class="ml-1 text-stone-700 underline">{m.ci_bath_reserve()}</a>
				{/if}
			</p>
		{/if}
	{/if}

	{#if ctx.editable}
		<a href={localizeHref('/ci')} class="mt-4 inline-block text-sm text-stone-600 underline">{m.ci_done_edit()}</a>
	{/if}
</section>

{#if noticeParts.length}
	<section class="mt-4 rounded-2xl bg-white p-5 text-sm shadow-sm">
		<h2 class="text-base font-semibold">{m.ci_done_notice()}</h2>
		<p class="mt-2 whitespace-pre-line break-words leading-relaxed text-stone-700">{#each noticeParts as part, i (i)}{#if part.href}<a href={part.href} target="_blank" rel="noopener noreferrer" class="text-stone-900 underline">{part.text}</a>{:else}{part.text}{/if}{/each}</p>
	</section>
{/if}

<a href={`${localizeHref('/ci/go')}?to=inroom`} data-sveltekit-reload class="mt-4 block w-full rounded-xl bg-stone-900 py-3 text-center text-sm font-medium text-white">{m.ci_done_inroom()}</a>

<p class="mt-4 text-center text-xs text-stone-500">{slashDate(ctx.checkIn)} · {ctx.facility.name}</p>
