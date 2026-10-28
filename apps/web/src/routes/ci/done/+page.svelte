<script lang="ts">
	// ④ 完了。選んだ食事の時間をまとめて出し、客室案内（/r）・貸切風呂（/r/bath）へ案内する。
	// 案内のリンクは /ci/go を通す: 回答済み・チェックイン日 12:00 より前なら滞在トークンを Cookie（ab_stay）に入れてから移るので、
	// 6 桁コードを入れずに開ける（P3）。OTA 経由の予約には公式サイトへの誘導カードを出す。
	import PrecheckinOtaBanner from '$lib/components/PrecheckinOtaBanner.svelte';
	import * as m from '$lib/paraglide/messages';
	import { localizeHref } from '$lib/paraglide/runtime';
	import { slashDate, type PcMealType } from '$lib/precheckin';
	import { otaBannerHref } from '$lib/precheckin-p3';

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
	const go = (to: 'inroom' | 'bath') => `${localizeHref('/ci/go')}?to=${to}`;
	const bannerHref = $derived(data.otaBanner ? otaBannerHref(ctx.facility, localizeHref) : null);
</script>

<section class="rounded-2xl bg-white p-5 text-sm shadow-sm">
	<h2 class="text-base font-semibold">{m.ci_done_title()}</h2>
	<p class="mt-2 leading-relaxed">{m.ci_done_lead()}</p>

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

	{#if ctx.editable}
		<a href={localizeHref('/ci')} class="mt-4 inline-block text-sm text-stone-600 underline">{m.ci_done_edit()}</a>
	{/if}
</section>

<section class="mt-4 rounded-2xl bg-white p-5 text-sm shadow-sm">
	<p class="leading-relaxed">{m.ci_done_inroom_help()}</p>
	<a href={go('inroom')} class="mt-4 block w-full rounded-xl bg-stone-900 py-3 text-center text-sm font-medium text-white">{m.ci_done_inroom()}</a>
	<a href={go('bath')} class="mt-3 block w-full rounded-xl bg-white py-3 text-center text-sm text-stone-700 ring-1 ring-stone-300">{m.ci_bath_reserve()}</a>
</section>

{#if bannerHref}
	<PrecheckinOtaBanner href={bannerHref} variant="card" welcomeBonus={data.welcomeBonus} />
{/if}

<p class="mt-4 text-center text-xs text-stone-500">{slashDate(ctx.checkIn)} · {ctx.facility.name}</p>
