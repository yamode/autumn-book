<script lang="ts">
	import { enhance } from '$lib/enhance';
	import * as m from '$lib/paraglide/messages';
	import { renderForumBody } from '$lib/forum-format';
	import { formatDate } from '$lib/format';
	import type { ForumPostView } from '$lib/types';

	// 1投稿の表示。本文は renderForumBody の出力のみ {@html} で描画（エスケープ済み・XSS 不可）。
	let { post, canDelete = false, canReport = false, report, onReply }: {
		post: ForumPostView;
		canDelete?: boolean;
		canReport?: boolean;
		report?: { success?: boolean; error?: string; reason?: string; note?: string };
		onReply?: (postNo: number) => void;
	} = $props();

	const reasons = $derived([
		{ code: 'spam', label: m.forum_report_spam() },
		{ code: 'abuse', label: m.forum_report_abuse() },
		{ code: 'privacy', label: m.forum_report_privacy() },
		{ code: 'other', label: m.forum_report_other() }
	]);

	let html = $derived(post.isDeleted ? '' : renderForumBody(post.body));
	let initial = $derived(post.nickname ? [...post.nickname][0] : '?');
</script>

<!-- 左に頭文字（画像）、右に名前・本文。1番目の投稿（話題）と運営の投稿は枠で目立たせる -->
<article id="post-{post.postNo}" class="post scroll-mt-24" class:post-op={post.postNo === 1 && !post.isDeleted} class:post-staff={post.isStaff && !post.isDeleted && post.postNo !== 1}>
	<div class="hidden shrink-0 sm:block">
		{#if !post.isDeleted && post.avatarUrl}
			<img src={post.avatarUrl} alt="" class="h-10 w-10 rounded-full object-cover" />
		{:else}
			<span class="post-avatar" class:post-avatar-staff={post.isStaff && !post.isDeleted} aria-hidden="true">{post.isDeleted ? '–' : initial}</span>
		{/if}
	</div>
	<div class="min-w-0 flex-1">
	<header class="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
		{#if !post.isDeleted}
			{#if post.avatarUrl}
				<img src={post.avatarUrl} alt="" class="h-7 w-7 rounded-full object-cover sm:hidden" />
			{:else}
				<span class="post-avatar post-avatar-sm sm:hidden" class:post-avatar-staff={post.isStaff} aria-hidden="true">{initial}</span>
			{/if}
			<span class="min-w-0 break-all font-semibold text-brand-900">{post.nickname}</span>
			{#if post.isStaff}<span class="rounded bg-brand-800 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">{m.forum_staff_badge()}</span>{/if}
		{/if}
		<span class="text-stone-500"><a href="#post-{post.postNo}" class="font-mono hover:underline">{m.forum_post_anchor({ n: post.postNo })}</a> · <time class="tabular-nums" datetime={post.createdAt}>{formatDate(post.createdAt.slice(0, 10))}</time></span>
		{#if canDelete && post.isOwn && !post.isDeleted}
			<form method="POST" action="?/deletePost" use:enhance class="ml-auto" onsubmit={(e) => { if (!confirm(m.forum_delete_confirm())) e.preventDefault(); }}>
				<input type="hidden" name="postId" value={post.id} />
				<button type="submit" class="min-h-9 px-2 text-xs text-stone-600 hover:text-red-600">{m.forum_delete_post()}</button>
			</form>
		{/if}
	</header>

	{#if post.isDeleted}
		<p class="text-base italic text-stone-400">{m.forum_deleted_post()}</p>
	{:else}
		<div class="post-body break-words text-stone-800">{@html html}</div>
		{#if onReply || (canReport && !post.isOwn)}
			<div class="mt-2 flex items-start gap-2 has-[details[open]]:block">
				{#if onReply}
					<button type="button" class="min-h-11 shrink-0 rounded-md px-2 text-sm font-medium text-brand-800 hover:bg-stone-50" onclick={() => onReply?.(post.postNo)}>
						{m.forum_reply()}
					</button>
				{/if}
				{#if canReport && !post.isOwn}
					{#if report?.success}
						<p class="flex min-h-11 items-center px-2 text-sm text-emerald-800" role="status">{m.forum_report_sent()}</p>
					{:else}
						<details class="min-w-0 flex-1" open={Boolean(report?.error)}>
							<summary class="flex min-h-11 w-fit cursor-pointer list-none items-center rounded-md px-2 text-sm text-stone-600 hover:bg-stone-50 [&::-webkit-details-marker]:hidden">
								{m.forum_report()} <span aria-hidden="true" class="ml-1 text-xs">▾</span>
							</summary>
							<form method="POST" action="?/report" use:enhance class="mb-2 grid gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
								<input type="hidden" name="postId" value={post.id} />
								<p class="text-xs leading-5 text-stone-600">{m.forum_report_private()}</p>
								{#if report?.error}<p role="alert" class="break-words text-sm text-red-800">{report.error}</p>{/if}
								<label class="text-sm text-stone-700">
									{m.forum_report_reason()}
									<select name="reason" required value={report?.reason ?? ''} class="mt-1 min-h-11 w-full rounded-md border border-stone-300 bg-white px-2 py-2">
										<option value="" disabled>{m.forum_report_select()}</option>
										{#each reasons as reason (reason.code)}<option value={reason.code}>{reason.label}</option>{/each}
									</select>
								</label>
								<label class="text-sm text-stone-700">
									{m.forum_report_note()}
									<textarea name="note" maxlength="500" rows="2" class="mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-2">{report?.note ?? ''}</textarea>
								</label>
								<button class="min-h-11 rounded-md bg-brand-800 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">{m.forum_report_send()}</button>
							</form>
						</details>
					{/if}
				{/if}
			</div>
		{/if}
	{/if}
	</div>
</article>

<style>
	.post {
		display: flex;
		gap: 0.875rem;
		padding: 1.25rem 0.25rem;
		border-top: 1px solid #e7e3da;
	}
	.post:first-child { border-top: 0; }
	/* 1 番目（話題）は本文を少し大きく、下を濃い罫線で区切る */
	.post-op { padding-bottom: 1.5rem; border-bottom: 1px solid var(--color-brand-900); }
	.post-op + :global(.post) { border-top: 0; }
	.post-staff { background: #faf9f6; }
	.post-avatar {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 9999px;
		background: var(--color-brand-100);
		color: var(--color-brand-800);
		font-size: 0.95rem;
		font-weight: 600;
	}
	.post-avatar-staff { background: var(--color-brand-800); color: #fff; }
	.post-avatar-sm { width: 1.75rem; height: 1.75rem; font-size: 0.75rem; }
	/* 名前の横の小さい頭文字はスマホだけ（.post-avatar の display が sm:hidden より強いのでここで消す） */
	@media (width >= 40rem) { .post-avatar-sm { display: none; } }
	@media (width < 40rem) {
		.post { padding: 1.125rem 0; }
	}
	.post-body { line-height: 1.85; }
	.post-op .post-body { font-size: 1.0625rem; }
</style>
