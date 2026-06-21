<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { renderForumBody } from '$lib/forum-format';

	let { data } = $props();

	// 投稿ステータスのラベル・配色
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

<svelte:head><title>{m.otayori_nav()}</title></svelte:head>

<!-- 残高（1pt=1,000円分 併記・設計書 §6） -->
<div class="rounded-2xl border border-stone-200 bg-white p-6">
	<p class="text-sm text-stone-500">{m.otayori_balance_label()}</p>
	<p class="mt-1 text-3xl font-bold text-brand-900">{data.balance.toLocaleString()} <span class="text-base font-normal">{m.common_point_unit()}</span></p>
	<p class="mt-2 text-xs text-stone-400">{m.otayori_value_note()}（{(data.balance * 1000).toLocaleString()}円分）</p>
</div>

<!-- 台帳履歴 -->
<section class="mt-6 rounded-2xl border border-stone-200 bg-white p-6">
	<h2 class="mb-3 font-medium text-brand-900">{m.otayori_history()}</h2>
	<div class="divide-y divide-stone-100">
		{#each data.ledger as entry}
			<div class="flex items-center justify-between py-2.5 text-sm">
				<div>
					<p>{entry.reason}</p>
					<p class="text-xs text-stone-400">{entry.createdAt}</p>
				</div>
				<span class="font-medium {entry.delta > 0 ? 'text-emerald-700' : 'text-red-600'}">
					{entry.delta > 0 ? '+' : ''}{entry.delta.toLocaleString()}{m.common_point_unit()}
				</span>
			</div>
		{:else}
			<p class="py-4 text-sm text-stone-400">{m.otayori_no_history()}</p>
		{/each}
	</div>
</section>

<!-- 自分の投稿一覧（申請中 / 採用・承認済 / 見送り） -->
<section class="mt-6 rounded-2xl border border-stone-200 bg-white p-6">
	<h2 class="mb-3 font-medium text-brand-900">{m.otayori_my_posts()}</h2>
	<div class="space-y-3">
		{#each data.posts as post}
			<div class="rounded-xl border border-stone-200 p-4">
				<div class="mb-2 flex flex-wrap items-center gap-2">
					<span class="rounded-full px-2 py-0.5 text-xs {statusCls[post.status]}">{statusLabel[post.status]}</span>
					{#if post.radioName}<span class="text-xs text-stone-400">{m.otayori_radio_name_label()}: {post.radioName}</span>{/if}
					<span class="ml-auto text-xs text-stone-400">{post.createdAt}</span>
				</div>
				<p class="text-sm break-words whitespace-pre-wrap text-stone-700">{@html renderForumBody(post.body)}</p>
				{#if post.status === 'rejected' && post.reviewNote}
					<p class="mt-2 rounded bg-stone-50 px-2 py-1 text-xs text-stone-500">{m.otayori_review_note_label()}: {post.reviewNote}</p>
				{/if}
			</div>
		{:else}
			<p class="py-4 text-sm text-stone-400">{m.otayori_no_posts()}</p>
		{/each}
	</div>
</section>
