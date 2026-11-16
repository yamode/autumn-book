<script lang="ts">
	import RankBadge from '$lib/components/RankBadge.svelte';
	import { RANK_CODES } from '$lib/plan-access';
	import { rankCondition, rankVisits } from '$lib/member-rank';
	import { formatDateLong } from '$lib/format';
	import { renderForumBody } from '$lib/forum-format';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let rank = $derived(data.rankProgress?.rank_code ?? data.member.rank);
	let currentRank = $derived(data.ranks.find((r) => r.code === rank)!);
	let nextRank = $derived(RANK_CODES[RANK_CODES.indexOf(rank) + 1]);
	let nextTarget = $derived(nextRank ? rankVisits[nextRank] : null);

	// おたより投稿ステータスのラベル・配色
	const statusLabel = $derived({
		pending: m.otayori_status_pending(),
		approved: m.otayori_status_approved(),
		rejected: m.otayori_status_rejected()
	} as const);
	const statusCls = {
		pending: 'bg-amber-50 text-amber-700',
		approved: 'bg-emerald-50 text-emerald-700',
		rejected: 'bg-stone-100 text-stone-500'
	} as const;
</script>

<svelte:head><title>{m.points_title()}</title></svelte:head>

<!-- 残高・ランク -->
<div class="grid gap-4 sm:grid-cols-2">
	<div class="rounded-2xl border border-stone-200 bg-white p-6">
		<p class="text-sm text-stone-500">{m.points_balance_label()}</p>
		<p class="mt-1 text-4xl font-bold text-brand-900">{data.balance.toLocaleString()} <span class="text-lg font-normal">{m.common_point_unit()}</span></p>
		{#if data.expiring > 0}
			<p class="mt-3 rounded-lg bg-amber-50 px-3 py-1.5 text-sm text-amber-800">{m.points_expiring({ points: String(data.expiring) })}</p>
		{/if}
		<p class="mt-3 text-sm text-stone-400">{m.points_rate_note()}</p>
	</div>

	<div id="member-rank" class="scroll-mt-24 rounded-2xl border border-stone-200 bg-white p-6">
		<div class="flex items-center justify-between">
			<p class="text-sm text-stone-500">{m.points_grade_label()}</p>
			<RankBadge {rank} />
		</div>
		<p class="mt-2 text-base">{m.points_reward_rate()} <strong class="text-lg text-accent-600">{Math.round(currentRank.rewardRate * 100)}%</strong></p>
		{#if data.rankProgress}
			{@const visits = data.rankProgress.visits}
			<p class="mt-4 flex justify-between gap-3 text-sm font-medium text-stone-700">
				<span>{m.points_qualified_visits()}</span>
				<span class="shrink-0 tabular-nums">{m.points_visit_count({ n: String(visits) })}</span>
			</p>
			<dl class="mt-2 space-y-1 text-sm text-stone-600">
				{#each data.rankProgress.by_facility as facility (facility.facility_id)}
					<div class="flex justify-between gap-3">
						<dt class="min-w-0 break-words">{facility.name}</dt>
						<dd class="shrink-0 tabular-nums">{m.points_visit_count({ n: String(facility.visits) })}</dd>
					</div>
				{/each}
			</dl>
			{#if data.rankProgress.review_on}
				<p class="mt-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-900">{m.points_rank_review({ date: formatDateLong(data.rankProgress.review_on) })}</p>
			{/if}
			{#if nextTarget}
				<p class="mt-2 text-sm text-stone-600">
					{visits >= nextTarget ? m.points_rank_pending() : m.points_to_next({ n: String(nextTarget - visits) })}
				</p>
				<progress class="mt-2 block h-2.5 w-full accent-accent-600" max={nextTarget} value={Math.min(visits, nextTarget)} aria-label={m.points_rank_progress()}></progress>
			{:else}
				<p class="mt-2 text-sm text-stone-600">{m.points_top_rank()}</p>
			{/if}
		{:else}
			<p class="mt-4 text-sm text-stone-600">{m.points_rank_unavailable()}</p>
		{/if}
	</div>
</div>

<!-- 会員グレード一覧 -->
<section class="mt-6 rounded-2xl border border-stone-200 bg-white p-6">
	<h2 class="mb-4 text-lg">{m.points_grade_list()}</h2>
	<table class="w-full text-[15px]">
		<thead><tr class="border-b border-stone-200 text-left text-sm text-stone-500"><th class="py-2">{m.points_grade_rank()}</th><th>{m.points_grade_condition()}</th><th class="text-right">{m.points_grade_rate()}</th></tr></thead>
		<tbody>
			{#each data.ranks as r}
				<tr class="border-b border-stone-100 {r.code === rank ? 'bg-amber-50/50' : ''}">
					<td class="py-2.5"><RankBadge rank={r.code} /></td>
					<td class="text-stone-600">{rankCondition(r.code)}</td>
					<td class="text-right font-semibold">{Math.round(r.rewardRate * 100)}%</td>
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

<!-- おたよりポイント（統合）: 残高・台帳・マイ投稿 -->
<section class="mt-10">
	<div class="mb-4 flex items-center gap-2">
		<h2 class="text-xl">{m.otayori_nav()}</h2>
		<span class="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">{m.points_otayori_badge()}</span>
	</div>

	<div class="rounded-2xl border border-stone-200 bg-white p-6">
		<p class="text-sm text-stone-500">{m.otayori_balance_label()}</p>
		<p class="mt-1 text-3xl font-bold text-brand-900">{data.otayori.balance.toLocaleString()} <span class="text-base font-normal">{m.common_point_unit()}</span></p>
		<p class="mt-2 text-sm text-stone-400">{m.otayori_value_note()}（{(data.otayori.balance * 1000).toLocaleString()}円分）</p>
	</div>

	<div class="mt-4 rounded-2xl border border-stone-200 bg-white p-6">
		<h3 class="mb-3 text-base">{m.otayori_history()}</h3>
		<div class="divide-y divide-stone-100">
			{#each data.otayori.ledger as entry}
				<div class="flex items-center justify-between py-3">
					<div>
						<p>{entry.reason}</p>
						<p class="text-sm text-stone-400">{entry.createdAt}</p>
					</div>
					<span class="font-semibold {entry.delta > 0 ? 'text-emerald-700' : 'text-red-600'}">
						{entry.delta > 0 ? '+' : ''}{entry.delta.toLocaleString()}{m.common_point_unit()}
					</span>
				</div>
			{:else}
				<p class="py-4 text-stone-400">{m.otayori_no_history()}</p>
			{/each}
		</div>
	</div>

	<div class="mt-4 rounded-2xl border border-stone-200 bg-white p-6">
		<h3 class="mb-3 text-base">{m.otayori_my_posts()}</h3>
		<div class="space-y-3">
			{#each data.otayori.posts as post}
				<div class="rounded-xl border border-stone-200 p-4">
					<div class="mb-2 flex flex-wrap items-center gap-2">
						<span class="rounded-full px-2 py-0.5 text-xs {statusCls[post.status]}">{statusLabel[post.status]}</span>
						{#if post.radioName}<span class="text-sm text-stone-400">{m.otayori_radio_name_label()}: {post.radioName}</span>{/if}
						<span class="ml-auto text-sm text-stone-400">{post.createdAt}</span>
					</div>
					<p class="break-words whitespace-pre-wrap text-stone-700">{@html renderForumBody(post.body)}</p>
					{#if post.status === 'rejected' && post.reviewNote}
						<p class="mt-2 rounded-lg bg-stone-50 px-3 py-1.5 text-sm text-stone-500">{m.otayori_review_note_label()}: {post.reviewNote}</p>
					{/if}
				</div>
			{:else}
				<p class="py-4 text-stone-400">{m.otayori_no_posts()}</p>
			{/each}
		</div>
	</div>
</section>
