<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import Turnstile from '$lib/components/Turnstile.svelte';
	import VerificationCodeField from '$lib/components/VerificationCodeField.svelte';
	import MemberPasskeyLogin from '$lib/components/MemberPasskeyLogin.svelte';
	import { getLocale } from '$lib/paraglide/runtime';
	import { memberLoginCopy } from '$lib/member-login-copy';

	let { data, form } = $props();
	let next = $derived(page.url.searchParams.get('next') ?? '');
	let nextQuery = $derived(next ? `&next=${encodeURIComponent(next)}` : '');
	// OTP の段階（email 入力 / code 入力）。フォールバックは email。
	let step = $derived(form?.step ?? 'email');
	let email = $derived(form?.email ?? '');
	const t = $derived(memberLoginCopy(getLocale()));
	const method = $derived(page.url.searchParams.get('method'));
	const smsMode = $derived(data.smsAvailable && (step === 'sms' || step === 'smsCode'
		|| (!form && (method === 'sms' || (method === null && data.smsDefault)))));
	const passwordMode = $derived(data.memberLoginMethods && !smsMode && step !== 'code'
		&& (step === 'password' || (step === 'email' && !form && method === 'password')));
	const methodHref = (method: string) => `/auth/login?method=${method}${nextQuery}`;
</script>

<svelte:head><title>{m.login_title()}</title></svelte:head>

<div class="mx-auto max-w-md px-4 py-12">
	<h1 class="font-display mb-6 text-center text-2xl text-brand-900">{m.login_heading()}</h1>

	{#if form?.message}
		<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
	{:else if step === 'email' && data.accountNotice}
		<p class="mb-4 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">{data.accountNotice}</p>
	{/if}

	{#if data.authMode === 'supabase'}
		{#if step === 'code'}
			<!-- step2: 8桁コード入力 -->
			<form method="POST" action="?/verify{nextQuery}" class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
				<p class="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">{m.auth_otp_code_hint({ email })}</p>
				<input type="hidden" name="email" value={email} />
				<VerificationCodeField />
				<button type="submit" class="w-full rounded-lg bg-brand-800 py-2.5 font-medium text-white hover:bg-brand-700">{m.auth_otp_verify()}</button>
			</form>
			<!-- 再送は Turnstile を出さない（最初の画面で確認済み。サーバは署名付き Cookie で同じメールアドレスか確かめる） -->
			<div class="mt-3 space-y-3 text-sm">
				<form method="POST" action="?/sendCode{nextQuery}" use:enhance class="space-y-3">
					<input type="hidden" name="email" value={email} />
					<input type="hidden" name="resend" value="1" />
					<div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
						<button type="submit" class="text-accent-600 underline">{m.auth_otp_resend()}</button>
						<a data-sveltekit-reload href={methodHref('email')} class="text-stone-500 underline">{m.auth_otp_change_email()}</a>
					</div>
				</form>
				{#if data.smsAvailable}<a data-sveltekit-reload href={methodHref('sms')} class="inline-flex min-h-11 items-center underline">{t.smsUseSms}</a>{/if}
			</div>
		{:else if step === 'smsCode' && data.smsAvailable}
			<form method="POST" action="?/verifySms{nextQuery}" class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
				<p class="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">{t.smsSent}</p>
				<VerificationCodeField sms />
				<button type="submit" class="w-full rounded-lg bg-brand-800 py-2.5 font-medium text-white hover:bg-brand-700">{m.auth_otp_verify()}</button>
			</form>
			<div class="mt-3 flex flex-wrap gap-x-4 text-sm">
				<a data-sveltekit-reload href={methodHref('sms')} class="inline-flex min-h-11 items-center underline">{t.smsTryAgain}</a>
				<a data-sveltekit-reload href={methodHref('email')} class="inline-flex min-h-11 items-center underline">{t.smsUseEmail}</a>
			</div>
		{:else}
			{#if data.memberLoginMethods}
				{#if data.passkeys}<div class="mb-4"><MemberPasskeyLogin {next} /></div>{/if}
				<nav aria-label={t.title} class="mb-3 grid gap-1 rounded-lg bg-stone-100 p-1 text-center text-sm {data.smsAvailable ? 'grid-cols-3' : 'grid-cols-2'}">
					<a data-sveltekit-reload href={methodHref('password')} aria-current={passwordMode ? 'page' : undefined} class="rounded-md px-2 py-2.5" class:bg-white={passwordMode}>{t.password}</a>
					<a data-sveltekit-reload href={methodHref('email')} aria-current={!passwordMode && !smsMode ? 'page' : undefined} class="rounded-md px-2 py-2.5" class:bg-white={!passwordMode && !smsMode}>{t.email}</a>
					{#if data.smsAvailable}
						<a data-sveltekit-reload href={methodHref('sms')} aria-current={smsMode ? 'page' : undefined} class="rounded-md px-2 py-2.5" class:bg-white={smsMode}>{t.sms}</a>
					{/if}
				</nav>
			{/if}
			{#if passwordMode}
				<form method="POST" action="?/password{nextQuery}" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
					<label class="block text-sm">
						<span class="text-stone-600">{m.login_email()}</span>
						<input type="email" name="email" value={email} required autocomplete="username" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
					</label>
					<label class="block text-sm">
						<span class="text-stone-600">{m.login_password()}</span>
						<input type="password" name="password" required autocomplete="current-password" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
					</label>
					<Turnstile action="member-password" showSuccess />
					<button type="submit" class="w-full rounded-lg bg-brand-800 py-2.5 font-medium text-white hover:bg-brand-700">{m.login_submit()}</button>
				</form>
			{:else if smsMode}
				<form method="POST" action="?/sendSms{nextQuery}" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
					<label class="block text-sm">
						<span class="text-stone-600">{t.smsPhone}</span>
						<input type="tel" name="phone" autocomplete="tel" required maxlength="30" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
					</label>
					<Turnstile action="member-sms" showSuccess />
					<button type="submit" class="w-full rounded-lg bg-brand-800 py-2.5 font-medium text-white hover:bg-brand-700">{m.auth_otp_send()}</button>
				</form>
			{:else}
			<!-- step1: メールアドレス入力 -->
			<form method="POST" action="?/sendCode{nextQuery}" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
				<p class="text-sm text-stone-500">{m.auth_otp_email_hint()}</p>
				<label class="block text-sm">
					<span class="text-stone-600">{m.login_email()}</span>
					<input type="email" name="email" value={email} required class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder="mail@example.com" />
				</label>
				<Turnstile action="member-otp" showSuccess />
				<button type="submit" class="w-full rounded-lg bg-brand-800 py-2.5 font-medium text-white hover:bg-brand-700">{m.auth_otp_send()}</button>
			</form>
			{/if}
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
		{m.login_register_link()} <a href="/auth/register{next ? `?next=${encodeURIComponent(next)}` : ''}" class="text-accent-600 underline">{m.login_register_anchor()}</a>
	</p>
</div>
