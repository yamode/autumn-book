<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
</script>

<svelte:head><title>{m.forum_new_thread_heading()} ｜ {data.board.title}</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-10">
	<nav class="mb-3 text-xs text-stone-400">
		<a href="/community" class="hover:underline">{m.forum_board_breadcrumb()}</a> /
		<a href="/community/{data.board.slug}" class="hover:underline">{data.board.title}</a>
	</nav>

	<h1 class="font-display mb-1 text-2xl text-brand-900">{m.forum_new_thread_heading()}</h1>
	<p class="mb-5 text-sm text-stone-500">{m.forum_new_thread_in({ board: data.board.title })}</p>

	{#if form?.message}
		<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
	{/if}

	<form method="POST" action="?/create" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
		<label class="block text-sm">
			<span class="text-stone-600">{m.forum_thread_title_label()}</span>
			<input name="title" value={form?.title ?? ''} required maxlength="80" placeholder={m.forum_thread_title_ph()} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
		</label>
		<label class="block text-sm">
			<span class="text-stone-600">{m.forum_body_label()}</span>
			<textarea name="body" rows="8" required maxlength="4000" placeholder={m.forum_body_ph()} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2">{form?.body ?? ''}</textarea>
		</label>
		<div class="flex items-center gap-3">
			<button type="submit" class="rounded-lg bg-brand-800 px-5 py-2 font-medium text-white hover:bg-brand-700">{m.forum_submit_thread()}</button>
			<a href="/community/{data.board.slug}" class="text-sm text-stone-500 hover:underline">{m.forum_back_to_board()}</a>
		</div>
	</form>
</div>
