<script lang="ts">
	import { formatDateLong } from '$lib/format';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import { memberDisplayRank, memberDisplayRanks, rankCondition, rankTargets } from '$lib/member-rank';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let actualRank = $derived(data.rankProgress?.rank_code ?? data.member.rank);
	let rank = $derived(memberDisplayRank(actualRank));
	let currentRank = $derived(data.ranks.find((r) => r.code === actualRank)!);
	let grades = $derived(memberDisplayRanks.map((code) => data.ranks.find((r) => r.code === code)!));
	let nextRank = $derived(memberDisplayRanks[memberDisplayRanks.indexOf(rank) + 1]);
	let nextTarget = $derived(nextRank ? rankTargets[nextRank] : null);
</script>

<svelte:head><title>{m.points_title()}</title></svelte:head>

<!-- 残高・ランク -->
<div class="grid gap-4 sm:grid-cols-2">
	<div class="rounded-2xl border border-stone-200 bg-white p-6">
		<p class="text-sm text-stone-500">{m.points_balance_label()}</p>
		<p class="mt-1 text-4xl font-bold text-brand-900">{data.balance.toLocaleString()} <span class="text-lg font-normal">{m.common_point_unit()}</span></p>
		{#if data.nextExpiry}
			<p class="mt-3 rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-800">{m.points_expiring({ date: formatDateLong(data.nextExpiry.date), points: data.nextExpiry.points.toLocaleString() })}</p>
		{/if}
		<p class="mt-3 text-sm text-stone-400">{m.points_rate_note()}</p>
		<p class="mt-1 text-sm text-stone-500">{m.points_validity()}</p>
	</div>

	<div id="member-rank" class="scroll-mt-24 rounded-2xl border border-stone-200 bg-white p-6">
		<div class="flex items-center justify-between">
			<p class="text-sm text-stone-500">{m.points_grade_label()}</p>
			<RankBadge {rank} />
		</div>
		<p class="mt-2 text-base">{m.points_reward_rate()} <strong class="text-lg text-accent-600">{Math.round(currentRank.rewardRate * 100)}%</strong></p>
		{#if data.rankProgress}
			{@const { visits, nights } = data.rankProgress}
			<p class="mt-4 flex justify-between gap-3 text-sm font-medium text-stone-700">
				<span>{m.points_qualified_visits()}</span>
				<span class="shrink-0 tabular-nums">{m.points_stay_counts({ visits: String(visits), nights: String(nights) })}</span>
			</p>
			<dl class="mt-2 space-y-1 text-sm text-stone-600">
				{#each data.rankProgress.by_facility as facility (facility.facility_id)}
					<div class="flex justify-between gap-3">
						<dt class="min-w-0 break-words">{facility.name}</dt>
						<dd class="shrink-0 tabular-nums">{m.points_stay_counts({ visits: String(facility.visits), nights: String(facility.nights) })}</dd>
					</div>
				{/each}
			</dl>
			{#if nextTarget}
				{@const remainingVisits = nextTarget.visits - visits}
				{@const remainingNights = nextTarget.nights === null ? null : nextTarget.nights - nights}
				<p class="mt-2 text-sm text-stone-600">
					{#if remainingVisits <= 0 || (remainingNights !== null && remainingNights <= 0)}
						{m.points_rank_pending()}
					{:else if remainingNights === null}
						{m.points_visits_to_next({ visits: String(remainingVisits) })}
					{:else}
						{m.points_to_next({ visits: String(remainingVisits), nights: String(remainingNights) })}
					{/if}
				</p>
			{:else}
				<p class="mt-2 text-sm text-stone-600">{m.points_top_rank()}</p>
			{/if}
		{:else}
			<p class="mt-4 text-sm text-stone-600">{m.points_rank_unavailable()}</p>
		{/if}
	</div>
</div>

<!-- 会員グレード一覧 -->
<section class="mt-6 rounded-2xl border border-stone-200 bg-white p-4 sm:p-6" aria-labelledby="points-grade-list">
	<h2 id="points-grade-list" class="mb-3 text-lg sm:mb-4">{m.points_grade_list()}</h2>
	<ul class="space-y-2 sm:hidden">
		{#each grades as r (r.code)}
			<li aria-current={r.code === rank ? 'true' : undefined}
				class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-3 {r.code === rank ? 'border-stone-300 bg-stone-50' : 'border-stone-200'}">
				<div><RankBadge rank={r.code} compact /></div>
				<p class="whitespace-nowrap text-right">
					<span class="mr-1 text-xs text-stone-600">{m.points_grade_rate()}</span>
					<strong class="text-lg tabular-nums text-brand-900">{Math.round(r.rewardRate * 100)}%</strong>
				</p>
				<p class="col-span-full text-sm leading-relaxed text-stone-600">
					<span class="sr-only">{m.points_grade_condition()} </span>{rankCondition(r.code)}
				</p>
			</li>
		{/each}
	</ul>
	<table class="hidden w-full text-[15px] sm:table">
		<thead><tr class="border-b border-stone-200 text-left text-sm text-stone-500"><th scope="col" class="py-2">{m.points_grade_rank()}</th><th scope="col" class="px-3">{m.points_grade_condition()}</th><th scope="col" class="whitespace-nowrap text-right">{m.points_grade_rate()}</th></tr></thead>
		<tbody>
			{#each grades as r (r.code)}
				<tr class="border-b border-stone-100 {r.code === rank ? 'bg-amber-50/50' : ''}">
					<td class="py-2.5 whitespace-nowrap"><RankBadge rank={r.code} /></td>
					<td class="px-3 text-stone-600">{rankCondition(r.code)}</td>
					<td class="whitespace-nowrap text-right font-semibold">{Math.round(r.rewardRate * 100)}%</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<!-- ポイント履歴 -->
<section class="mt-6 rounded-2xl border border-stone-200 bg-white p-6">
	<h2 class="mb-3 text-lg">{m.points_history()}</h2>
	<div class="divide-y divide-stone-100">
		{#each data.ledger as entry}
			<div class="flex items-center justify-between py-3">
				<div>
					<p>{entry.reason}</p>
					<p class="text-sm text-stone-400">{entry.createdAt}{entry.expiresAt ? m.points_expiry({ date: entry.expiresAt }) : ''}</p>
				</div>
				<span class="font-semibold {entry.delta > 0 ? 'text-emerald-700' : 'text-red-600'}">
					{entry.delta > 0 ? '+' : ''}{entry.delta.toLocaleString()}{m.common_point_unit()}
				</span>
			</div>
		{:else}
			<p class="py-4 text-stone-400">{m.points_no_history()}</p>
		{/each}
	</div>
</section>

<a href="/account/coupons#otayori" class="mt-5 inline-flex min-h-11 items-center text-sm font-medium text-brand-800 underline underline-offset-4">{m.otayori_thanks_mypage()}</a>
