<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
</script>

<svelte:head><title>{m.register_title()}</title></svelte:head>

<div class="mx-auto max-w-md px-4 py-12">
	<h1 class="font-display mb-2 text-center text-2xl text-brand-900">{m.register_heading()}</h1>
	<p class="mb-6 text-center text-sm text-stone-500">{m.register_sub()}</p>

	<form method="POST" action="?/register" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
		<label class="block text-sm">
			<span class="text-stone-600">{m.register_email()} <span class="text-red-500">*</span></span>
			<input type="email" name="email" value={form?.values?.email ?? data.prefill.email} required class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.email ? 'border-red-400' : 'border-stone-300'}" />
			{#if form?.errors?.email}<span class="text-xs text-red-600">{form.errors.email}</span>{/if}
		</label>
		<label class="block text-sm">
			<span class="text-stone-600">{m.register_password()} <span class="text-red-500">*</span></span>
			<input type="password" name="password" required class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.password ? 'border-red-400' : 'border-stone-300'}" />
			{#if form?.errors?.password}<span class="text-xs text-red-600">{form.errors.password}</span>{/if}
		</label>
		<div class="grid grid-cols-2 gap-3">
			<label class="block text-sm">
				<span class="text-stone-600">{m.register_name()} <span class="text-red-500">*</span></span>
				<input name="name" value={form?.values?.name ?? data.prefill.name} required class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.name ? 'border-red-400' : 'border-stone-300'}" placeholder="山田 太郎" />
			</label>
			<label class="block text-sm">
				<span class="text-stone-600">{m.register_kana()} <span class="text-red-500">*</span></span>
				<input name="kana" value={form?.values?.kana ?? ''} required class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.kana ? 'border-red-400' : 'border-stone-300'}" placeholder="ヤマダ タロウ" />
			</label>
		</div>
		<label class="block text-sm">
			<span class="text-stone-600">{m.register_phone()}</span>
			<input name="phone" value={form?.values?.phone ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder="090-0000-0000" />
		</label>
		<label class="flex items-start gap-2 text-sm">
			<input type="checkbox" name="mailOptIn" class="mt-0.5 h-4 w-4" />
			<span class="text-stone-600">{m.register_mail_opt_in()}<span class="block text-xs text-stone-400">{m.register_mail_opt_in_sub()}</span></span>
		</label>
		<button type="submit" class="w-full rounded-lg bg-accent-600 py-2.5 font-medium text-white hover:bg-accent-500">{m.register_submit()}</button>
		<p class="text-center text-xs text-stone-400">{m.register_privacy_note()} <a href="/legal/privacy" class="underline">{m.register_privacy_link()}</a>{m.register_privacy_agree()}</p>
	</form>

	<p class="mt-6 text-center text-sm text-stone-600">
		{m.register_login_link()} <a href="/auth/login" class="text-accent-600 underline">{m.register_login_anchor()}</a>
	</p>
</div>
