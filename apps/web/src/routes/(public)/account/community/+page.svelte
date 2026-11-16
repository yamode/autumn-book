<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { formatDate } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
	let current = $derived(form?.nickname ?? data.nickname);
	const hasUnread = $derived(data.forumUnread > 0 || data.notices.some((notice) => !notice.read_at));
</script>

<svelte:head><title>{m.account_nav_community()} ｜ 山人</title></svelte:head>

<div class="space-y-5">
	<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
		<h2 class="text-2xl">{m.account_nav_community()}</h2>
		<a href="/community" class="inline-flex min-h-11 items-center rounded-lg border border-stone-200 bg-white px-3 text-sm font-medium text-brand-800 hover:bg-stone-50">{m.account_open_community()}</a>
	</div>

	{#if !data.writeEnabled}
		<div class="rounded-2xl border border-brand-200 bg-brand-50 p-6">
			<p class="font-semibold text-brand-900">{m.forum_write_app_only_heading()}</p>
			<p class="mt-1 text-stone-700">{m.forum_write_app_only()}</p>
		</div>
	{:else if data.next}
		{@render nicknameSettings()}
		{@render notifications()}
	{:else}
		{@render notifications()}
		{@render nicknameSettings()}
	{/if}
</div>

{#snippet nicknameSettings()}
	<section aria-labelledby="nickname-heading" class="space-y-4 rounded-2xl border border-stone-200 bg-white p-4 sm:p-6">
		<div>
			<h3 id="nickname-heading" class="text-lg font-semibold">{m.forum_nickname_settings_heading()}</h3>
			<p class="mt-1 text-sm text-stone-600">{m.forum_nickname_settings_sub()}</p>
		</div>
		{#if form?.saved}
			<p class="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{m.forum_nickname_saved()}</p>
		{/if}
		{#if form?.message}
			<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{form.message}</p>
		{/if}
		{#if data.next}
			<p class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{m.forum_nickname_required_notice()}</p>
		{/if}

		<form method="POST" action="?/save" use:enhance class="max-w-md space-y-4">
			<input type="hidden" name="next" value={data.next} />
			<label class="block">
				<span class="text-sm text-stone-600">{m.forum_nickname_label()}</span>
				<input name="nickname" value={current} required minlength="2" maxlength="20" placeholder={m.forum_nickname_ph()} class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" />
				{#if data.nickname}
					<span class="mt-1 block text-sm text-stone-400">{m.forum_nickname_current()}: {data.nickname}</span>
				{/if}
			</label>
			<button type="submit" class="min-h-11 rounded-lg bg-brand-800 px-4 py-2.5 font-medium text-white hover:bg-brand-700">{m.forum_nickname_save()}</button>
		</form>
	</section>
{/snippet}

{#snippet notifications()}
	<section id="reply-notifications" aria-labelledby="reply-notifications-heading" class="scroll-mt-32 rounded-2xl border border-stone-200 bg-white p-4 sm:p-6">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h3 id="reply-notifications-heading" class="text-lg font-semibold">{m.forum_notifications()}</h3>
			{#if data.notices.length > 0 && hasUnread}
				<form method="POST" action="?/markAll" use:enhance>
					<input type="hidden" name="through" value={data.notices[0].created_at} />
					<button class="min-h-11 rounded-lg border border-stone-300 px-3 text-sm text-brand-800 hover:bg-stone-50">{m.forum_mark_all_read()}</button>
				</form>
			{/if}
		</div>
		<p class="mt-1 text-sm leading-6 text-stone-600">{m.forum_notifications_about()}</p>
		{#if form?.noticeMessage || data.inboxFailed}
			<p role="alert" class="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{form?.noticeMessage ?? m.forum_notifications_load_error()}</p>
		{/if}
		{#if form?.marked}<p role="status" class="mt-4 text-sm text-emerald-800">{m.forum_notifications_marked()}</p>{/if}
		{#if data.notices.length > 0}
			<ul class="mt-4 divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200">
				{#each data.notices as notice (notice.id)}
					<li class={!notice.read_at ? 'bg-amber-50/50' : ''}>
						<form method="POST" action="?/open" use:enhance>
							<input type="hidden" name="id" value={notice.id} />
							<button class="block min-h-16 w-full p-3 text-left hover:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-800 sm:p-4">
								<span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-600">
									{#if !notice.read_at}<span class="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">{m.forum_unread()}</span>{/if}
									<time datetime={notice.created_at}>{formatDate(notice.created_at.slice(0, 10))}</time>
									{#if notice.nickname}<span class="max-w-full wrap-break-word">{notice.nickname}</span>{/if}
								</span>
								<span class="mt-1 block wrap-break-word font-medium text-brand-900">{notice.title}</span>
							</button>
						</form>
					</li>
				{/each}
			</ul>
		{:else if !data.inboxFailed}
			<p class="mt-4 rounded-lg bg-stone-50 p-3 text-sm text-stone-600">{m.forum_notifications_empty()}</p>
		{/if}
	</section>
{/snippet}
