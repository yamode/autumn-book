<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import { enhance } from '$lib/enhance';
	import * as m from '$lib/paraglide/messages';
	import ForumPostView from '$lib/components/ForumPostView.svelte';
	import ForumCta from '$lib/components/ForumCta.svelte';

	let { data, form } = $props();
	let replyInput: HTMLTextAreaElement | undefined = $state();
	const canReply = $derived(data.isLoggedIn && data.hasNickname && data.writeEnabled && !data.thread.isLocked);

	function quote(postNo: number) {
		if (!replyInput) return;
		const prefix = `>>${postNo}\n`;
		const body = replyInput.value.replace(/^>>\d+\n/, '');
		if (body.length + prefix.length <= replyInput.maxLength) replyInput.value = prefix + body;
		replyInput.focus();
		replyInput.setSelectionRange(replyInput.value.length, replyInput.value.length);
	}
</script>

<svelte:head><title>{data.thread.title} ｜ {m.forum_title()}</title></svelte:head>

<div class="forum-shell mx-auto max-w-5xl px-4 py-10">
	<BackLink href="/community/{data.thread.boardSlug}" target={data.thread.boardTitle} />

	<h1 class="mb-4 break-words text-2xl text-brand-900">
		{#if data.thread.isPinned}<span aria-label={m.forum_label_pinned()}>📌</span>{/if}
		{#if data.thread.isLocked}<span aria-label={m.forum_label_locked()}>🔒</span>{/if}
		{data.thread.title}
	</h1>

	{#if canReply}<a href="#forum-reply" class="mb-4 inline-flex min-h-10 items-center rounded-lg border border-stone-200 px-3 text-sm text-brand-800">{m.forum_reply_heading()}</a>{/if}
	<div class="rounded-2xl border border-stone-200 bg-white">
		{#each data.posts as post (post.id)}
			<ForumPostView
				{post}
				canDelete={data.isLoggedIn && data.writeEnabled}
				canReport={data.isLoggedIn && data.writeEnabled}
				report={form?.reportPostId === post.id ? { success: form.reportSuccess, error: form.reportError, reason: form.reportReason, note: form.reportNote } : undefined}
				onReply={canReply ? quote : undefined}
			/>
		{/each}
	</div>

	<!-- 返信フォーム / ロック通知 / 未ログイン CTA（設計書 §6） -->
	{#if form?.reportError && !data.posts.some((post) => post.id === form.reportPostId && !post.isDeleted)}
		<p role="alert" class="mt-4 text-sm text-red-800">{form.reportError}</p>
	{/if}
	<div id="forum-reply" class="mt-6 scroll-mt-24">
		{#if !data.writeEnabled}
			<div class="rounded-2xl border border-brand-200 bg-brand-50 p-4 sm:p-5">
				<p class="font-medium text-brand-900">{m.forum_write_app_only_heading()}</p>
				<p class="mt-1 text-sm text-stone-700">{m.forum_write_app_only()}</p>
			</div>
		{:else if data.thread.isLocked}
			<p class="rounded-lg bg-stone-100 px-3 py-2.5 text-sm text-stone-600">{m.forum_locked_notice()}</p>
		{:else if data.isLoggedIn}
			{#if form?.message}
				<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
			{/if}
			{#if !data.hasNickname}
				<p class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
					{m.forum_nickname_required_notice()}
					<a href="/account/community?next={encodeURIComponent(`/community/threads/${data.thread.id}`)}" class="underline">{m.forum_nickname_settings_heading()}</a>
				</p>
			{:else}
			<form method="POST" action="?/reply" data-reset use:enhance class="rounded-2xl border border-stone-200 bg-white p-4">
				<h2 class="mb-2 text-sm font-medium text-stone-700">{m.forum_reply_heading()}</h2>
				<p class="mb-2 text-xs leading-5 text-stone-600">{m.forum_public_notice()}</p>
				<textarea bind:this={replyInput} aria-label={m.forum_reply_heading()} name="body" rows="4" required maxlength="4000" placeholder={m.forum_body_ph()} class="w-full rounded-md border border-stone-300 px-3 py-2 text-sm">{form?.body ?? ''}</textarea>
				<button type="submit" class="mt-2 rounded-lg bg-brand-800 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">{m.forum_submit_reply()}</button>
			</form>
			{/if}
		{:else}
			<ForumCta showBanner={true} facilities={[]} />
		{/if}
	</div>

	<div class="mt-6">
		<a href="/community/{data.thread.boardSlug}" class="text-sm text-stone-500 hover:underline">{m.forum_back_to_board()}</a>
	</div>

	<ForumCta showBanner={false} facilities={data.facilities} />
</div>
