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

<article id="post-{post.postNo}" class="scroll-mt-20 border-t border-stone-100 px-4 py-4 first:border-t-0">
	<header class="mb-2 flex flex-wrap items-center gap-2 text-sm text-stone-400">
		<span class="font-mono text-stone-500">{m.forum_post_anchor({ n: post.postNo })}</span>
		{#if !post.isDeleted}
			{#if post.avatarUrl}
				<img src={post.avatarUrl} alt="" class="h-6 w-6 rounded-full object-cover" />
			{:else}
				<span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-[11px] font-medium text-brand-800">{initial}</span>
			{/if}
			<span class="min-w-0 break-all font-medium text-stone-600">{post.nickname}</span>
			{#if post.isStaff}<span class="rounded bg-brand-800 px-1.5 py-0.5 text-[10px] font-medium text-white">{m.forum_staff_badge()}</span>{/if}
		{/if}
		<time class="tabular-nums">{formatDate(post.createdAt.slice(0, 10))}</time>
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
		<div class="break-words text-base leading-relaxed text-stone-700">{@html html}</div>
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
</article>
