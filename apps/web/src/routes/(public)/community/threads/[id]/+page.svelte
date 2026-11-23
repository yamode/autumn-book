<script lang="ts">
	import BackLink from '$lib/components/BackLink.svelte';
	import { enhance } from '$lib/enhance';
	import * as m from '$lib/paraglide/messages';
	import ForumPostView from '$lib/components/ForumPostView.svelte';
	import ForumCta from '$lib/components/ForumCta.svelte';
	import { formatDate } from '$lib/format';
	import { page } from '$app/state';
	import { canonicalPublicPath } from '$lib/experiments';
	import { jsonLdScript, threadDescription, threadJsonLd } from '$lib/forum-seo';

	let { data, form } = $props();
	let replyInput: HTMLTextAreaElement | undefined = $state();
	// AI 検索・検索エンジン向け（$lib/forum-seo.ts）
	const canonical = $derived(`${page.url.origin}${canonicalPublicPath(page.url.pathname)}`);
	const description = $derived(threadDescription(data.thread.title, data.thread.boardTitle, data.posts));
	const jsonLd = $derived(jsonLdScript(threadJsonLd({
		url: canonical,
		boardUrl: `${page.url.origin}/community/${data.thread.boardSlug}`,
		boardTitle: data.thread.boardTitle,
		title: data.thread.title,
		createdAt: data.thread.createdAt,
		lastPostedAt: data.thread.lastPostedAt,
		posts: data.posts
	})));
	const canReply = $derived(data.isLoggedIn && data.rankOk && data.hasNickname && data.writeEnabled && !data.thread.isLocked);

	function quote(postNo: number) {
		if (!replyInput) return;
		const prefix = `>>${postNo}\n`;
		const body = replyInput.value.replace(/^>>\d+\n/, '');
		if (body.length + prefix.length <= replyInput.maxLength) replyInput.value = prefix + body;
		replyInput.focus();
		replyInput.setSelectionRange(replyInput.value.length, replyInput.value.length);
	}
</script>

<svelte:head>
	<title>{data.thread.title} ｜ {data.thread.boardTitle} ｜ {m.forum_title()}</title>
	<meta name="description" content={description} />
	<link rel="canonical" href={canonical} />
	<meta property="og:type" content="article" />
	<meta property="og:title" content={data.thread.title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta property="article:published_time" content={data.thread.createdAt} />
	<meta property="article:modified_time" content={data.thread.lastPostedAt} />
	{@html jsonLd}
</svelte:head>

<div class="forum-shell mx-auto max-w-3xl px-4 pb-14 pt-8 sm:pt-10">
	<BackLink href="/community/{data.thread.boardSlug}" target={data.thread.boardTitle} />

	<header class="mb-6 mt-4">
		<div class="flex flex-wrap items-center gap-1.5">
			<a href="/community/{data.thread.boardSlug}" class="rounded-full border border-brand-100 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100">{data.thread.boardTitle}</a>
			{#if data.thread.isPinned}<span class="rounded-full border border-[#ecdcb5] bg-[#fcf6e7] px-2.5 py-0.5 text-xs font-semibold text-[#7a5d22]">{m.forum_label_pinned()}</span>{/if}
			{#if data.thread.isLocked}<span class="rounded-full border border-stone-200 bg-stone-100 px-2.5 py-0.5 text-xs font-semibold text-stone-500">{m.forum_label_locked()}</span>{/if}
		</div>
		<h1 class="mt-3 break-words text-2xl leading-snug sm:text-[1.875rem]">{data.thread.title}</h1>
		<p class="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-stone-500">
			<span class="tabular-nums">{m.forum_replies_count({ n: data.posts.filter((p) => !p.isDeleted).length })}</span>
			<span aria-hidden="true">·</span>
			<span>{m.forum_last_posted()} <time datetime={data.thread.lastPostedAt} class="tabular-nums">{formatDate(data.thread.lastPostedAt.slice(0, 10))}</time></span>
			{#if canReply}<a href="#forum-reply" class="pill ml-auto min-h-9">{m.forum_reply_heading()}</a>{/if}
		</p>
	</header>

	<div class="border-y border-t-brand-900 border-b-[#e7e3da]">
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
		{:else if data.isLoggedIn && !data.rankOk}
			<p class="rounded-lg bg-stone-100 px-3 py-2.5 text-sm text-stone-600">{m.forum_rank_required_notice()} <a href="/membership" class="underline">{m.nav_membership()}</a></p>
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
			<form method="POST" action="?/reply" data-reset use:enhance class="rounded-xl border border-stone-300 bg-white p-4 sm:p-5">
				<h2 class="mb-2 text-sm font-medium text-stone-700">{m.forum_reply_heading()}</h2>
				<p class="mb-2 text-xs leading-5 text-stone-600">{m.forum_public_notice()}</p>
				<textarea bind:this={replyInput} aria-label={m.forum_reply_heading()} name="body" rows="4" required maxlength="4000" class="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-3.5 py-2.5 text-[0.95rem] leading-7 transition focus:border-brand-600 focus:bg-white focus:outline-none">{form?.body ?? ''}</textarea>
				<div class="mt-3 flex justify-end"><button type="submit" class="inline-flex min-h-11 items-center rounded-full bg-brand-800 px-6 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700">{m.forum_submit_reply()}</button></div>
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
