<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { formatDate } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
</script>

<svelte:head><title>{m.forum_notifications()} ｜ 山人</title></svelte:head>

<div class="mx-auto max-w-2xl">
	<div class="flex flex-wrap items-center justify-between gap-4">
		<h2 class="text-xl font-semibold text-brand-900">{m.forum_notifications()}</h2>
		{#if data.notices.length > 0 && (data.forumUnread || data.notices.some(n => !n.read_at))}
			<form method="POST" action="?/markAll" use:enhance>
				<input type="hidden" name="through" value={data.notices[0].created_at} />
				<button class="min-h-11 rounded-lg border border-stone-300 px-3 text-sm text-brand-800 hover:bg-stone-50">{m.forum_mark_all_read()}</button>
			</form>
		{/if}
	</div>
	<p class="mt-2 text-sm leading-6 text-stone-600">{m.forum_notifications_about()}</p>
	{#if form?.message}<p role="alert" class="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{form.message}</p>{/if}
	{#if form?.marked}<p role="status" class="mt-4 text-sm text-emerald-800">{m.forum_notifications_marked()}</p>{/if}

	{#if !data.enabled || data.notices.length === 0}
		<p class="mt-5 rounded-xl border border-dashed border-stone-300 p-5 text-sm text-stone-600">{data.enabled ? m.forum_notifications_empty() : m.forum_write_app_only()}</p>
	{:else}
		<ul class="mt-5 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
			{#each data.notices as notice (notice.id)}
				<li class={!notice.read_at ? 'bg-amber-50/50' : ''}>
					<form method="POST" action="?/open" use:enhance>
						<input type="hidden" name="id" value={notice.id} />
						<button class="block min-h-16 w-full p-4 text-left hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-brand-800">
							<span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-600">
								{#if !notice.read_at}<span class="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">{m.forum_unread()}</span>{/if}
								<time datetime={notice.created_at}>{formatDate(notice.created_at.slice(0, 10))}</time>
								{#if notice.nickname}<span class="max-w-full break-all">{notice.nickname}</span>{/if}
							</span>
							<span class="mt-1 block break-words font-medium text-brand-900">{notice.title}</span>
						</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
	<a href="/community" class="mt-5 inline-flex min-h-11 items-center text-sm text-brand-800 underline">{m.forum_back_to_community()}</a>
</div>
