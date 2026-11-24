<script lang="ts">
	import { renderForumBody } from '$lib/forum-format';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	let { data } = $props();
	const letterDate = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' });

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

<svelte:head><title>{m.otayori_thanks_mypage()} ｜ 山人</title></svelte:head>

<a href="/account/points" class="mb-2 inline-flex min-h-11 items-center text-sm text-stone-500 hover:text-stone-800">← {m.account_nav_points()}</a>
<h2 class="mb-5 text-2xl">{m.otayori_thanks_mypage()}</h2>
<section id="otayori" aria-labelledby="otayori-title" class="scroll-mt-24">
	<div class="mb-4 flex items-center gap-2">
		<h3 id="otayori-title" class="sr-only">{m.otayori_nav()}</h3>
		<a href="/kitakaze#letter" class="ml-auto text-sm text-brand-800 underline">{m.radio_letter_title()}</a>
	</div>

	<div class="rounded-2xl border border-stone-200 bg-white p-6">
		<p class="text-sm text-stone-500">{m.otayori_balance_label()}</p>
		<p class="mt-1 text-3xl font-bold text-brand-900">{m.otayori_letter_count({ count: data.otayori.balance.toLocaleString() })}</p>
		<!-- おたより1通につき通常のポイントを 1,000pt 付ける（2026-11-23）。使うのはポイントの画面から -->
		<p class="mt-2 text-sm text-stone-500">
			{m.otayori_value_note()} <a href="/account/points" class="text-brand-800 underline">{m.otayori_points_link()}</a>
		</p>
	</div>

	<div class="mt-4 rounded-2xl border border-stone-200 bg-white p-6">
		<h4 class="mb-3 text-base">{m.otayori_history()}</h4>
		<div class="divide-y divide-stone-100">
			{#each data.otayori.ledger as entry}
				<div class="flex items-center justify-between py-3">
					<div>
						<p>{entry.reason}</p>
						<p class="text-sm text-stone-500">{letterDate.format(new Date(entry.createdAt))}</p>
						{#if entry.sourcePostId}
							<a href={`#letter-${entry.sourcePostId}`} class="mt-1 inline-block text-sm text-brand-800 underline">{m.radio_view_letter()}</a>
						{/if}
					</div>
					<span class="font-semibold {entry.delta > 0 ? 'text-emerald-700' : 'text-red-600'}">
						{m.otayori_letter_count({ count: (entry.delta > 0 ? '+' : '') + entry.delta.toLocaleString() })}
					</span>
				</div>
			{:else}
				<p class="py-4 text-stone-400">{m.otayori_no_history()}</p>
			{/each}
		</div>
	</div>

	<div class="mt-4 rounded-2xl border border-stone-200 bg-white p-6">
		<h4 class="mb-3 text-base">{m.otayori_my_posts()}</h4>
		<div class="space-y-3">
			{#each data.otayori.posts as post}
				<div id={`letter-${post.id}`} class="scroll-mt-24 rounded-xl border border-stone-200 p-4">
					<div class="mb-2 flex flex-wrap items-center gap-2">
						<span class="rounded-full px-2 py-0.5 text-xs {statusCls[post.status]}">{statusLabel[post.status]}</span>
						{#if post.radioName}<span class="text-sm text-stone-400">{m.otayori_radio_name_label()}: {post.radioName}</span>{/if}
						<span class="ml-auto text-sm text-stone-400">{post.createdAt}</span>
					</div>
					<p class="break-words whitespace-pre-wrap text-stone-700">{@html renderForumBody(post.body)}</p>
					{#if post.awardedAt}
						<p class="mt-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800">{m.radio_awarded({ date: letterDate.format(new Date(post.awardedAt)) })}</p>
					{/if}
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
