<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
	let current = $derived(form?.nickname ?? data.nickname);
</script>

<svelte:head><title>{m.forum_nickname_settings_title()} ｜ 山人</title></svelte:head>

<div class="max-w-lg space-y-6">
	<div>
		<h2 class="text-xl">{m.forum_nickname_settings_heading()}</h2>
		<p class="mt-1 text-sm text-stone-500">{m.forum_nickname_settings_sub()}</p>
	</div>

	{#if !data.writeEnabled}
		<div class="rounded-2xl border border-brand-200 bg-brand-50 p-6">
			<p class="font-semibold text-brand-900">{m.forum_write_app_only_heading()}</p>
			<p class="mt-1 text-stone-700">{m.forum_write_app_only()}</p>
			<a href="/community" class="mt-3 inline-block text-sm text-stone-500 hover:underline">{m.forum_back_to_community()}</a>
		</div>
	{:else}
		{#if form?.saved}
			<p class="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{m.forum_nickname_saved()}</p>
		{/if}
		{#if form?.message}
			<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{form.message}</p>
		{/if}
		{#if data.next}
			<p class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{m.forum_nickname_required_notice()}</p>
		{/if}

		<form method="POST" action="?/save" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
			<input type="hidden" name="next" value={data.next} />
			<label class="block">
				<span class="text-sm text-stone-600">{m.forum_nickname_label()}</span>
				<input name="nickname" value={current} required minlength="2" maxlength="20" placeholder={m.forum_nickname_ph()} class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" />
				{#if data.nickname}
					<span class="mt-1 block text-sm text-stone-400">{m.forum_nickname_current()}: {data.nickname}</span>
				{/if}
			</label>
			<button type="submit" class="rounded-lg bg-brand-800 px-6 py-2.5 font-medium text-white hover:bg-brand-700">{m.forum_nickname_save()}</button>
		</form>

		<p class="text-sm text-stone-500"><a href="/community" class="hover:underline">← {m.forum_back_to_community()}</a></p>
	{/if}
</div>
