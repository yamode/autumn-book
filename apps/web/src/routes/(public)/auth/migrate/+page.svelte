<script lang="ts">
	// 旧会員の方（会員移行）の入口。メールを入力すると、以前の予約システムの会員なら移行の案内メールが届く
	import { enhance } from '$lib/enhance';
	import * as m from '$lib/paraglide/messages';
	import Turnstile from '$lib/components/Turnstile.svelte';

	let { data, form } = $props();
	let sent = $derived(form && 'sent' in form && form.sent === true);
</script>

<svelte:head><title>{m.migrate_title()}</title></svelte:head>

<div class="mx-auto max-w-md px-4 py-12">
	<h1 class="font-display mb-2 text-center text-2xl text-brand-900">{m.migrate_heading()}</h1>
	<p class="mb-6 text-sm leading-6 text-stone-600">{m.migrate_lead()}</p>

	{#if !data.available}
		<p class="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">{m.migrate_unavailable()}</p>
	{:else if sent}
		<div class="space-y-3 rounded-2xl border border-stone-200 bg-white p-6 text-sm leading-6 text-stone-700" role="status">
			<p class="font-medium text-brand-900">{m.migrate_sent_heading()}</p>
			<p>{m.migrate_sent_body({ email: form?.email ?? '' })}</p>
			<p class="text-xs text-stone-500">{m.migrate_sent_note()}</p>
		</div>
	{:else}
		{#if form?.message}
			<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{form.message}</p>
		{/if}
		<form method="POST" action="?/invite" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
			<label class="block text-sm">
				<span class="text-stone-600">{m.migrate_email_label()} <span class="text-red-500">*</span></span>
				<input type="email" name="email" autocomplete="email" value={form?.email ?? ''} required class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder="mail@example.com" />
			</label>
			<Turnstile action="member-migrate" showSuccess />
			<button type="submit" class="w-full rounded-lg bg-accent-600 py-2.5 font-medium text-white hover:bg-accent-500">{m.migrate_submit()}</button>
		</form>
	{/if}

	<div class="mt-6 space-y-1 text-center text-sm text-stone-600">
		<p>{m.migrate_new_member()} <a href="/auth/register" class="text-accent-600 underline">{m.register_heading()}</a></p>
		<p>{m.migrate_already()} <a href="/auth/login" class="text-accent-600 underline">{m.register_login_anchor()}</a></p>
	</div>
</div>
