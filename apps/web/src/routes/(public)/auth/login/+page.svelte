<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';

	let { form } = $props();
	let next = $derived(page.url.searchParams.get('next') ?? '');
</script>

<svelte:head><title>{m.login_title()}</title></svelte:head>

<div class="mx-auto max-w-md px-4 py-12">
	<h1 class="font-display mb-6 text-center text-2xl text-brand-900">{m.login_heading()}</h1>

	{#if form?.message}
		<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
	{/if}

	<form method="POST" action="?/login{next ? `&next=${encodeURIComponent(next)}` : ''}" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
		<label class="block text-sm">
			<span class="text-stone-600">{m.login_email()}</span>
			<input type="email" name="email" value={form?.email ?? ''} required class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder="mail@example.com" />
		</label>
		<label class="block text-sm">
			<span class="text-stone-600">{m.login_password()}</span>
			<input type="password" name="password" required class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
		</label>
		<button type="submit" class="w-full rounded-lg bg-brand-800 py-2.5 font-medium text-white hover:bg-brand-700">{m.login_submit()}</button>
		<p class="text-center text-xs text-stone-400">{m.login_demo_hint()}</p>
	</form>

	<!-- マジックリンク・OAuth（本実装: Supabase Auth。LINE は §14-5 決定後） -->
	<div class="mt-4 space-y-2">
		<button type="button" disabled class="w-full rounded-lg border border-stone-300 bg-white py-2.5 text-sm text-stone-400">{m.login_magic_link()}</button>
		<button type="button" disabled class="w-full rounded-lg border border-stone-300 bg-white py-2.5 text-sm text-stone-400">{m.login_google()}</button>
		<button type="button" disabled class="w-full rounded-lg border border-stone-300 bg-white py-2.5 text-sm text-stone-400">{m.login_line()}</button>
	</div>

	<p class="mt-6 text-center text-sm text-stone-600">
		{m.login_register_link()} <a href="/auth/register" class="text-accent-600 underline">{m.login_register_anchor()}</a>
	</p>
</div>
