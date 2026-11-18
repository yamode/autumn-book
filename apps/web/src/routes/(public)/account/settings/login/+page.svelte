<script lang="ts">
	import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$lib/enhance';
	import { getLocale } from '$lib/paraglide/runtime';
	import { memberLoginCopy } from '$lib/member-login-copy';
	import type { SubmitFunction } from '@sveltejs/kit';

	let { data, form } = $props();
	const t = $derived(memberLoginCopy(getLocale()));
	let keyName = $state('');
	let keyBusy = $state(false);
	let keyStatus = $state<'' | 'error' | 'saved'>('');
	let enrolling = $state<{ id: string; qrCode: string; secret: string } | null>(null);
	const currentEnroll = $derived(form?.enroll ?? enrolling);
	const errors = $derived({
		recent: t.recent, password: t.passwordError, code: t.wrongCode, retainKey: t.retainKey,
		unavailable: t.unavailable, keyName: t.keyNameRequired, renameKey: t.renameKeyError
	});
	const panel = 'space-y-3 rounded-xl border border-stone-200 bg-white p-4 sm:p-5';
	const input = 'mt-1 w-full rounded-md border border-stone-300 px-3 py-2';
	const button = 'min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium hover:bg-stone-50 disabled:opacity-60';
	const submitButton = 'min-h-11 rounded-lg bg-brand-800 px-4 text-sm font-medium text-white hover:bg-brand-700';
	const finishRename: SubmitFunction = ({ formElement }) => async ({ result, update }) => {
		await update();
		if (result.type === 'success') formElement.closest('details')?.removeAttribute('open');
	};

	$effect(() => {
		if (form?.enroll) enrolling = form.enroll;
		if (form?.saved === 'totp' || !data.recent) enrolling = null;
	});

	const passkeyRequest = (body: Record<string, unknown>) => fetch('/account/settings/login/passkey', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
	});

	async function addPasskey(securityKey: boolean) {
		if (keyBusy) return;
		keyBusy = true;
		keyStatus = '';
		try {
			if (!browserSupportsWebAuthn()) throw new Error('unavailable');
			const optionsRequest = await passkeyRequest({ action: 'options', securityKey });
			if (!optionsRequest.ok) throw new Error('options');
			const { options, challengeId } = await optionsRequest.json();
			const response = await startRegistration({ optionsJSON: options });
			const verification = await passkeyRequest({ action: 'verify', challengeId, response, name: keyName });
			if (!verification.ok || !(await verification.json()).ok) throw new Error('verification');
			keyName = '';
			keyStatus = 'saved';
			await invalidateAll();
		} catch {
			keyStatus = 'error';
		} finally {
			keyBusy = false;
		}
	}
</script>

<svelte:head><title>{t.title} ｜ YAMADO</title></svelte:head>

<h2 class="mb-4 text-2xl">{t.title}</h2>
{#if data.unavailable}
	<p role="alert" class="text-sm text-red-700">{t.unavailable}</p>
{:else}
	{#if form?.issue}<p role="alert" class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{errors[form.issue]}</p>{/if}
	{#if form?.saved || keyStatus === 'saved'}<p role="status" class="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{t.saved}</p>{/if}
	{#if !data.recent}
		<div class={panel}>
			<p>{t.recent}</p>
			<form method="POST" action="/auth/logout?next=%2Faccount%2Fsettings%2Flogin">
				<button type="submit" class={button}>{t.restart}</button>
			</form>
		</div>
	{/if}
	<div class="mt-4 space-y-4">
		<section class={panel}>
			<h3 class="text-lg font-semibold">{t.passwordSetup}</h3>
			{#if data.recent}
				<form method="POST" action="?/password" data-reset use:enhance class="max-w-md space-y-3">
					{#if data.loginEmail}
						<input class="hidden" type="email" name="email" value={data.loginEmail} autocomplete="username" readonly />
					{/if}
					<p class="text-sm text-stone-600">{t.passwordHint}</p>
					<label class="block text-sm">{t.newPassword}
						<input class={input} name="password" type="password" autocomplete="new-password" minlength="12" maxlength="72" required />
					</label>
					<label class="block text-sm">{t.confirmPassword}
						<input class={input} name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="72" required />
					</label>
					<button type="submit" class={submitButton}>{t.save}</button>
				</form>
			{/if}
		</section>

		<section class={panel}>
			<h3 class="text-lg font-semibold">{t.keys}</h3>
			{#if data.keys.length}
				<ul class="divide-y divide-stone-100">
					{#each data.keys as key (key.id)}
						<li class="flex flex-wrap items-start justify-between gap-2 py-2">
							<span class="min-w-0 break-words">{key.device_name}</span>
							{#if data.recent}
								<form method="POST" action="?/removePasskey" use:enhance class="ml-auto">
									<input type="hidden" name="id" value={key.id} />
									<button type="submit" class={button} aria-label={`${t.remove} ${key.device_name}`}>{t.remove}</button>
								</form>
								<details class="w-full">
									<summary class="w-fit cursor-pointer text-sm underline" aria-label={`${t.renameKey} ${key.device_name}`}>{t.renameKey}</summary>
									<form method="POST" action="?/renamePasskey" use:enhance={finishRename} class="mt-2 flex max-w-md items-end gap-2">
										<input type="hidden" name="id" value={key.id} />
										<label class="min-w-0 flex-1 text-sm">{t.editKeyName}
											<input class={input} name="name" value={key.device_name} maxlength="60" required />
										</label>
										<button type="submit" class={`${submitButton} shrink-0`}>{t.save}</button>
									</form>
								</details>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-stone-600">{t.noKeys}</p>
			{/if}
			{#if data.recent && data.passkeysAvailable}
				<p class="text-sm text-stone-600">{t.keyHint}</p>
				<label class="block max-w-md text-sm">{t.keyName}<input class={input} maxlength="60" bind:value={keyName} /></label>
				<div class="flex flex-wrap gap-2">
					<button type="button" class={button} disabled={keyBusy} onclick={() => addPasskey(false)}>{t.addKey}</button>
					<button type="button" class={button} disabled={keyBusy} onclick={() => addPasskey(true)}>{t.addHardware}</button>
				</div>
				{#if keyStatus === 'error'}<p role="alert" class="text-sm text-red-700">{t.keyError}</p>{/if}
			{/if}
		</section>

		<section class={panel}>
			<h3 class="text-lg font-semibold">{t.totp}</h3>
			<p class="text-sm text-stone-600">{t.totpRecovery}</p>
			{#if data.factors.length}
				<ul class="divide-y divide-stone-100">
					{#each data.factors as factor (factor.id)}
						<li class="flex items-center justify-between gap-3 py-2">
							<span class="min-w-0 break-words">{factor.name || t.authenticatorApp}</span>
							{#if data.recent}
								<form method="POST" action="?/removeTotp" use:enhance>
									<input type="hidden" name="id" value={factor.id} />
									<button type="submit" class={button} aria-label={`${t.remove} ${factor.name}`}>{t.remove}</button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{:else if data.recent}
				{#if currentEnroll}
					<p class="text-sm text-stone-700">{t.qrHint}</p>
					<img src={currentEnroll.qrCode} alt={t.qr} width="180" height="180" />
					<details class="text-sm">
						<summary class="cursor-pointer">{t.manualKey}</summary>
						<code class="break-all">{currentEnroll.secret}</code>
					</details>
					<form method="POST" action="?/verifyTotp" use:enhance class="max-w-xs space-y-3">
						<input type="hidden" name="id" value={currentEnroll.id} />
						<label class="block text-sm">{t.code}
							<input class={input} name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required />
						</label>
						<button type="submit" class={submitButton}>{t.verify}</button>
					</form>
				{:else}
					<form method="POST" action="?/enroll" use:enhance class="max-w-md space-y-3">
						<label class="block text-sm">{t.authenticatorAppName}
							<input class={input} name="appName" maxlength="60" placeholder="Google Authenticator" />
						</label>
						<button type="submit" class={button}>{t.totpSetup}</button>
					</form>
				{/if}
			{/if}
		</section>
	</div>
{/if}
