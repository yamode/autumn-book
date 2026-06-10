<script lang="ts">
	import RankBadge from '$lib/components/RankBadge.svelte';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let member = $derived(data.member);
	let currentRank = $derived(data.ranks.find((r) => r.code === member.rank)!);
	// 次ランクまでの進捗（gold は最上位）
	let nextTarget = $derived(member.rank === 'standard' ? 2 : member.rank === 'silver' ? 5 : null);
</script>

<svelte:head><title>{m.points_title()}</title></svelte:head>

<div class="grid gap-4 sm:grid-cols-2">
	<div class="rounded-2xl border border-stone-200 bg-white p-6">
		<p class="text-sm text-stone-500">{m.points_balance_label()}</p>
		<p class="mt-1 text-3xl font-bold text-brand-900">{data.balance.toLocaleString()} <span class="text-base font-normal">{m.common_point_unit()}</span></p>
		{#if data.expiring > 0}
			<p class="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{m.points_expiring({ points: String(data.expiring) })}</p>
		{/if}
		<p class="mt-3 text-xs text-stone-400">{m.points_rate_note()}</p>
	</div>

	<div class="rounded-2xl border border-stone-200 bg-white p-6">
		<div class="flex items-center justify-between">
			<p class="text-sm text-stone-500">{m.points_grade_label()}</p>
			<RankBadge rank={member.rank} />
		</div>
		<p class="mt-2 text-sm">{m.points_reward_rate()} <strong class="text-accent-600">{Math.round(currentRank.rewardRate * 100)}%</strong></p>
		{#if nextTarget}
			<div class="mt-3">
				<p class="text-xs text-stone-500">{m.points_to_next({ n: String(Math.max(0, nextTarget - data.staysThisYear)) })}</p>
				<div class="mt-1 h-2 rounded-full bg-stone-100">
					<div class="h-2 rounded-full bg-accent-500" style="width: {Math.min(100, (data.staysThisYear / nextTarget) * 100)}%"></div>
				</div>
			</div>
		{:else}
			<p class="mt-3 text-xs text-stone-500">{m.points_top_rank()}</p>
		{/if}
	</div>
</div>

<section class="mt-6 rounded-2xl border border-stone-200 bg-white p-6">
	<h2 class="mb-3 font-medium text-brand-900">{m.points_grade_list()}</h2>
	<table class="w-full text-sm">
		<thead><tr class="border-b border-stone-200 text-left text-xs text-stone-500"><th class="py-2">{m.points_grade_rank()}</th><th>{m.points_grade_condition()}</th><th class="text-right">{m.points_grade_rate()}</th></tr></thead>
		<tbody>
			{#each data.ranks as r}
				<tr class="border-b border-stone-100 {r.code === member.rank ? 'bg-amber-50/50' : ''}">
					<td class="py-2"><RankBadge rank={r.code} /></td>
					<td class="text-stone-600">{r.condition}</td>
					<td class="text-right font-medium">{Math.round(r.rewardRate * 100)}%</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section class="mt-6 rounded-2xl border border-stone-200 bg-white p-6">
	<h2 class="mb-3 font-medium text-brand-900">{m.points_history()}</h2>
	<div class="divide-y divide-stone-100">
		{#each data.ledger as entry}
			<div class="flex items-center justify-between py-2.5 text-sm">
				<div>
					<p>{entry.reason}</p>
					<p class="text-xs text-stone-400">{entry.createdAt}{entry.expiresAt ? m.points_expiry({ date: entry.expiresAt }) : ''}</p>
				</div>
				<span class="font-medium {entry.delta > 0 ? 'text-emerald-700' : 'text-red-600'}">
					{entry.delta > 0 ? '+' : ''}{entry.delta.toLocaleString()}{m.common_point_unit()}
				</span>
			</div>
		{:else}
			<p class="py-4 text-sm text-stone-400">{m.points_no_history()}</p>
		{/each}
	</div>
</section>
