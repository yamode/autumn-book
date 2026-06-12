<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
	let current = $derived(form?.nickname ?? data.nickname);
</script>

<svelte:head><title>{m.forum_nickname_settings_title()} ｜ 山人</title></svelte:head>

<div class="mx-auto max-w-md px-4 py-12">
	<nav class="mb-3 text-xs text-stone-400">
		<a href="/community" class="hover:underline">{m.forum_board_breadcrumb()}</a> / {m.forum_nickname_settings_title()}
	</nav>

	<h1 class="font-display mb-1 text-2xl text-brand-900">{m.forum_nickname_settings_heading()}</h1>
	<p class="mb-5 text-sm text-stone-500">{m.forum_nickname_settings_sub()}</p>

	{#if form?.saved}
		<p class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{m.forum_nickname_saved()}</p>
	{/if}
	{#if form?.message}
		<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
	{/if}

	{#if data.next}
		<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{m.forum_nickname_required_notice()}</p>
	{/if}

	<form method="POST" action="?/save" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
		<input type="hidden" name="next" value={data.next} />
		<label class="block text-sm">
			<span class="text-stone-600">{m.forum_nickname_label()}</span>
			<input name="nickname" value={current} required minlength="2" maxlength="20" placeholder={m.forum_nickname_ph()} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
			{#if data.nickname}
				<span class="mt-1 block text-xs text-stone-400">{m.forum_nickname_current()}: {data.nickname}</span>
			{/if}
		</label>
		<button type="submit" class="w-full rounded-lg bg-brand-800 py-2.5 font-medium text-white hover:bg-brand-700">{m.forum_nickname_save()}</button>
	</form>
</div>
