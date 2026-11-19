<script lang="ts">
	// 旧会員の会員移行: 以前の登録内容を確かめ、パスワードを決めて新しい会員になる
	import { enhance } from '$lib/enhance';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
	const v = $derived(form?.values ?? (data.state === 'ready' ? data.values : undefined));
	const err = $derived((form?.errors ?? {}) as Record<string, string>);
	const message = $derived(form && 'message' in form ? (form.message as string) : '');
</script>

<svelte:head>
	<title>{m.migrate_title()}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-md px-4 py-12">
	<h1 class="font-display mb-2 text-center text-2xl text-brand-900">{m.migrate_heading()}</h1>

	{#if data.state === 'invalid'}
		<div class="space-y-3 rounded-2xl border border-stone-200 bg-white p-6 text-sm leading-6 text-stone-700">
			<p>{m.migrate_link_invalid()}</p>
			<a href="/auth/migrate" class="inline-block text-accent-600 underline">{m.migrate_again()}</a>
		</div>
	{:else if data.state === 'already'}
		<div class="space-y-3 rounded-2xl border border-stone-200 bg-white p-6 text-sm leading-6 text-stone-700">
			<p>{m.migrate_already_member()}</p>
			<a href="/auth/login" class="inline-block text-accent-600 underline">{m.register_login_anchor()}</a>
		</div>
	{:else}
		<p class="mb-6 text-sm leading-6 text-stone-600">{m.migrate_confirm_lead()}</p>
		{#if message}
			<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{message}</p>
		{/if}
		<form method="POST" action="?/complete" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6 max-[359px]:px-4">
			<p class="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{data.email}</p>
			<div class="grid grid-cols-2 gap-3">
				<label class="block text-sm">
					<span class="text-stone-600">{m.name_family()} <span class="text-red-500">*</span></span>
					<input name="familyName" value={v?.familyName ?? ''} required autocomplete="family-name" class="mt-1 w-full rounded-md border px-3 py-2 {err.familyName ? 'border-red-400' : 'border-stone-300'}" />
				</label>
				<label class="block text-sm">
					<span class="text-stone-600">{m.name_given()} <span class="text-red-500">*</span></span>
					<input name="givenName" value={v?.givenName ?? ''} required autocomplete="given-name" class="mt-1 w-full rounded-md border px-3 py-2 {err.givenName ? 'border-red-400' : 'border-stone-300'}" />
				</label>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<label class="block text-sm">
					<span class="text-stone-600">{m.name_family_kana()}</span>
					<input name="familyNameKana" value={v?.familyNameKana ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
				</label>
				<label class="block text-sm">
					<span class="text-stone-600">{m.name_given_kana()}</span>
					<input name="givenNameKana" value={v?.givenNameKana ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
				</label>
			</div>
			<label class="block text-sm">
				<span class="text-stone-600">{m.register_phone()}</span>
				<input type="tel" name="phone" autocomplete="tel" value={v?.phone ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
			</label>
			<label class="block text-sm">
				<span class="text-stone-600">{m.migrate_password()} <span class="text-red-500">*</span></span>
				<input type="password" name="password" autocomplete="new-password" required minlength="12" class="mt-1 w-full rounded-md border px-3 py-2 {err.password ? 'border-red-400' : 'border-stone-300'}" />
				<span class="mt-1 block text-xs {err.password ? 'text-red-600' : 'text-stone-500'}">{err.password ?? m.migrate_password_hint()}</span>
			</label>
			<label class="block text-sm">
				<span class="text-stone-600">{m.migrate_password_confirm()} <span class="text-red-500">*</span></span>
				<input type="password" name="passwordConfirm" autocomplete="new-password" required class="mt-1 w-full rounded-md border px-3 py-2 {err.passwordConfirm ? 'border-red-400' : 'border-stone-300'}" />
				{#if err.passwordConfirm}<span class="mt-1 block text-xs text-red-600">{err.passwordConfirm}</span>{/if}
			</label>
			<label class="grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 gap-y-1 rounded-lg bg-amber-50 px-2 py-2.5 text-sm sm:px-3">
				<input type="checkbox" name="mailOptIn" checked={form?.mailOptIn ?? true} class="mt-0.5 h-4 w-4 shrink-0 accent-amber-900" />
				<span class="font-medium text-amber-950">{m.register_mail_opt_in()}</span>
				<span class="col-span-2 text-xs text-amber-900">{m.register_mail_opt_in_sub()}</span>
			</label>
			<label class="flex cursor-pointer items-start gap-2 text-sm">
				<input type="checkbox" name="privacyConsent" required class="mt-0.5 h-4 w-4 shrink-0" />
				<span class="text-stone-700"><a href="/legal/privacy" target="_blank" rel="noopener" class="underline">{m.register_privacy_link()}</a>{m.migrate_consent_post()}</span>
			</label>
			{#if err.privacyConsent}<span class="block text-xs text-red-600">{err.privacyConsent}</span>{/if}
			<button type="submit" class="w-full rounded-lg bg-accent-600 py-2.5 font-medium text-white hover:bg-accent-500">{m.migrate_complete_submit()}</button>
			<p class="text-center text-xs text-stone-500">{m.migrate_rank_note()}</p>
		</form>
	{/if}
</div>
