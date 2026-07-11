<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
	let next = $derived(page.url.searchParams.get('next') ?? '');
	let nextQuery = $derived(next ? `&next=${encodeURIComponent(next)}` : '');
	// OTP の段階（email 入力 / code 入力）。フォールバックは email。
	let step = $derived(form?.step ?? 'email');
	let email = $derived(form?.email ?? '');
</script>

<svelte:head><title>{m.login_title()}</title></svelte:head>

<div class="mx-auto max-w-md px-4 py-12">
	<h1 class="font-display mb-6 text-center text-2xl text-brand-900">{m.login_heading()}</h1>

	{#if form?.message}
		<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
	{/if}

	{#if data.authMode === 'supabase'}
		{#if step === 'code'}
			<!-- step2: 8桁コード入力 -->
			<form method="POST" action="?/verify{nextQuery}" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
				<p class="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">{m.auth_otp_code_hint({ email })}</p>
				<input type="hidden" name="email" value={email} />
				<label class="block text-sm">
					<span class="text-stone-600">{m.auth_otp_code_label()}</span>
					<input
						name="token"
						inputmode="numeric"
						autocomplete="one-time-code"
						maxlength="8"
						required
						placeholder={m.auth_otp_code_placeholder()}
						class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-center text-lg tracking-[0.4em]"
					/>
				</label>
				<button type="submit" class="w-full rounded-lg bg-brand-800 py-2.5 font-medium text-white hover:bg-brand-700">{m.auth_otp_verify()}</button>
			</form>
			<div class="mt-3 flex items-center justify-between text-sm">
				<form method="POST" action="?/sendCode{nextQuery}" use:enhance>
					<input type="hidden" name="email" value={email} />
					<button type="submit" class="text-accent-600 underline">{m.auth_otp_resend()}</button>
				</form>
				<a href="/auth/login{next ? `?next=${encodeURIComponent(next)}` : ''}" class="text-stone-500 underline">{m.auth_otp_change_email()}</a>
			</div>
		{:else}
			<!-- step1: メールアドレス入力 -->
			<form method="POST" action="?/sendCode{nextQuery}" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
				<p class="text-sm text-stone-500">{m.auth_otp_email_hint()}</p>
				<label class="block text-sm">
					<span class="text-stone-600">{m.login_email()}</span>
					<input type="email" name="email" value={email} required class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder="mail@example.com" />
				</label>
				<button type="submit" class="w-full rounded-lg bg-brand-800 py-2.5 font-medium text-white hover:bg-brand-700">{m.auth_otp_send()}</button>
			</form>
		{/if}
	{:else}
		<!-- demo: email + パスワード -->
		<form method="POST" action="?/login{nextQuery}" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
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

		<!-- OAuth（本実装: Supabase Auth。LINE は §14-5 決定後） -->
		<div class="mt-4 space-y-2">
			<button type="button" disabled class="w-full rounded-lg border border-stone-300 bg-white py-2.5 text-sm text-stone-400">{m.login_google()}</button>
			<button type="button" disabled class="w-full rounded-lg border border-stone-300 bg-white py-2.5 text-sm text-stone-400">{m.login_line()}</button>
		</div>
	{/if}

	<p class="mt-6 text-center text-sm text-stone-600">
		{m.login_register_link()} <a href="/auth/register" class="text-accent-600 underline">{m.login_register_anchor()}</a>
	</p>
</div>
