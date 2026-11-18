<script lang="ts">
	import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
	import { tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$lib/enhance';
	import { getLocale } from '$lib/paraglide/runtime';
	import { memberLoginCopy } from '$lib/member-login-copy';
	import AdminIcon from '$lib/components/admin/AdminIcon.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';

	let { data, form } = $props();
	const t = $derived(memberLoginCopy(getLocale()));
	let keyName = $state('');
	let editingKeyId = $state<string | null>(null);
	let renameInput = $state<HTMLInputElement>();
	let authenticatorApp = $state('');
	let showPassword = $state(false);
	let newPassword = $state('');
	let confirmedPassword = $state('');
	let passwordBusy = $state(false);
	let confirmationInput = $state<HTMLInputElement>();
	let passwordForm = $state<HTMLFormElement>();
	let keyBusy = $state(false);
	let keyStatus = $state<'' | 'error' | 'saved'>('');
	let enrolling = $state<{ id: string; qrCode: string; secret: string } | null>(null);
	const currentEnroll = $derived(form?.enroll ?? enrolling);
	const errors = $derived({
		recent: t.recent, passwordLength: t.passwordLength, passwordMismatch: t.passwordMismatch,
		passwordSame: t.passwordSame, passwordWeak: t.passwordWeak,
		passwordTotp: t.passwordTotp, passwordSave: t.passwordSaveError, code: t.wrongCode, retainKey: t.retainKey,
		unavailable: t.unavailable, keyName: t.keyNameRequired, renameKey: t.renameKeyError
	});
	const panel = 'space-y-3 rounded-xl border border-stone-200 bg-white p-4 sm:p-5';
	const input = 'mt-1 w-full rounded-md border border-stone-300 px-3 py-2';
	const button = 'min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium hover:bg-stone-50 disabled:opacity-60';
	const submitButton = 'min-h-11 rounded-lg bg-brand-800 px-4 text-sm font-medium text-white hover:bg-brand-700';
	const keyAction = 'min-h-11 rounded-lg px-3 text-sm font-medium transition-colors';
	const passwordAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';

	function generatePassword() {
		// A 64-character alphabet makes each random byte map evenly to a character.
		let candidate: string;
		do {
			const bytes = crypto.getRandomValues(new Uint8Array(24));
			candidate = Array.from(bytes, (byte) => passwordAlphabet[byte % passwordAlphabet.length]).join('');
		} while (!(/[A-Z]/.test(candidate) && /[a-z]/.test(candidate) && /[2-9]/.test(candidate) && /[!@#$%&*]/.test(candidate)));

		newPassword = candidate;
		confirmedPassword = '';
		showPassword = true;
	}

	function submitPassword(event: SubmitEvent) {
		if (!confirmationInput?.reportValidity()) {
			event.preventDefault();
		}
	}

	function enhancePassword(passwordForm: HTMLFormElement) {
		const PasswordCredential = (window as Window & {
			PasswordCredential?: new (data: { id: string; password: string }) => Credential;
		}).PasswordCredential;
		if (!PasswordCredential || typeof navigator.credentials?.store !== 'function' || !data.member.email) return;

		return enhance(passwordForm, ({ formData, cancel }) => {
			if (passwordBusy || !confirmationInput?.reportValidity()) return cancel();
			const email = data.member.email;
			const password = formData.get('password');
			passwordBusy = true;
			return async ({ result, update }) => {
				try {
					if (result.type !== 'success' || result.data?.saved !== 'password' || typeof password !== 'string') {
						await update();
						return;
					}
					// Publish the successful result before handing off credentials. Keep the
					// password fields intact until that handoff so Chrome has one save signal.
					await update({ reset: false, invalidateAll: false });
					await tick();
					try {
						void navigator.credentials.store(new PasswordCredential({ id: email, password })).catch(() => {});
					} catch {
						// Browser storage is optional once the new password has been saved.
					} finally {
						showPassword = false;
						newPassword = '';
						confirmedPassword = '';
					}
				} finally {
					passwordBusy = false;
				}
			};
		});
	}

	function submitPasswordOnEnter(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.isComposing) return;
		event.preventDefault();
		passwordForm?.requestSubmit();
	}
	async function startRename(id: string) {
		editingKeyId = id;
		await tick();
		renameInput?.focus();
		renameInput?.select();
	}

	async function closeRename(id: string) {
		if (editingKeyId !== id) return;
		editingKeyId = null;
		await tick();
		document.getElementById(`rename-key-${id}`)?.focus();
	}

	const finishRename: SubmitFunction = ({ formData }) => async ({ result, update }) => {
		await update();
		if (result.type === 'success') await closeRename(String(formData.get('id')));
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

{#snippet restartLogin()}
	<form method="POST" action="/auth/logout?next=%2Faccount%2Fsettings%2Flogin">
		<button type="submit" class={button}>{t.restart}</button>
	</form>
{/snippet}

<h2 class="mb-4 text-2xl">{t.title}</h2>
{#if data.unavailable}
	<p role="alert" class="text-sm text-red-700">{t.unavailable}</p>
{:else}
	{#if form?.issue}<p role="alert" class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{errors[form.issue]}</p>{/if}
	{#if form?.saved || keyStatus === 'saved'}<p role="status" class="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{t.saved}</p>{/if}
	{#if !data.recent || form?.issue === 'recent'}
		<div class={panel}>
			{#if form?.issue !== 'recent'}<p>{t.recent}</p>{/if}
			{@render restartLogin()}
		</div>
	{/if}
	<div class="mt-4 space-y-4">
		<section class={panel}>
			<h3 class="text-lg font-semibold">{t.passwordSetup}</h3>
			{#if data.member.email}
				<div class="max-w-md space-y-1.5">
					<dl class="space-y-1.5">
						<dt class="text-sm font-medium text-stone-700">{t.passwordLoginEmail}</dt>
						<dd class="wrap-anywhere rounded-lg bg-stone-100 px-3 py-2.5 text-sm text-stone-600">{data.member.email}</dd>
					</dl>
					<a href="/account/profile#change-email" class="inline-block text-sm font-medium text-brand-800 underline underline-offset-4 hover:text-brand-600">{t.changeLoginEmail}</a>
				</div>
			{/if}
			{#if data.recent && (data.passwordNeedsTotp || form?.issue === 'passwordTotp')}
				{#if form?.issue !== 'passwordTotp'}<p class="text-sm text-stone-700">{t.passwordTotp}</p>{/if}
				{@render restartLogin()}
			{:else if data.recent && form?.issue !== 'recent'}
				<form id="confirm-password-form" method="POST" autocomplete="off" onsubmit={(event) => event.preventDefault()}></form>
				<form id="member-password-change" method="POST" action="?/password" bind:this={passwordForm} use:enhancePassword
					onsubmit={submitPassword} onformdata={({ formData }) => formData.set('confirm', confirmationInput?.value ?? '')}
					class="max-w-md space-y-3">
					{#if data.member.email}
						<input class="hidden" type="email" name="email" value={data.member.email} autocomplete="username" readonly />
					{/if}
					<p id="password-hint" class="text-sm text-stone-600">{t.passwordLength}</p>
					<div>
						<div class="flex flex-wrap items-center justify-between gap-x-2">
							<label for="new-password" class="block text-sm">{t.newPassword}</label>
							<button type="button" class="min-h-11 rounded-lg bg-stone-100 px-3 text-sm font-medium text-brand-800 hover:bg-stone-200 disabled:opacity-60"
								disabled={passwordBusy} onclick={generatePassword}>{t.generatePassword}</button>
						</div>
						<div class="mt-1 flex items-center gap-2">
							<input id="new-password" class="min-w-0 flex-1 rounded-md border border-stone-300 px-3 py-2"
								name="password" type="password" bind:value={newPassword} autocomplete="off"
								aria-describedby="password-hint" minlength="12" autocapitalize="off" spellcheck={false} required />
							<button type="button" class={`${button} shrink-0`} aria-expanded={showPassword}
								onclick={() => showPassword = !showPassword}>{showPassword ? t.hidePassword : t.showPassword}</button>
						</div>
						{#if showPassword && newPassword}
							<p class="mt-1 wrap-anywhere whitespace-pre-wrap rounded-md bg-stone-100 px-3 py-2 font-mono text-sm">{newPassword}</p>
						{/if}
					</div>
					<label for="confirm-entry" class="block text-sm">{t.confirmPassword}
						<!-- 別フォームに所属させ、ブラウザが生成したパスワードを確認欄に複製するのを防ぐ。 -->
						<input form="confirm-password-form" id="confirm-entry" bind:this={confirmationInput}
							class={input} type="password" bind:value={confirmedPassword} autocomplete="off"
							autocapitalize="off" spellcheck={false} onkeydown={submitPasswordOnEnter} required />
					</label>
					{#if showPassword && confirmedPassword}
						<p class="wrap-anywhere whitespace-pre-wrap rounded-md bg-stone-100 px-3 py-2 font-mono text-sm">{confirmedPassword}</p>
					{/if}
					<button type="submit" class={`${submitButton} disabled:opacity-60`} disabled={passwordBusy}>{t.save}</button>
				</form>
			{/if}
		</section>

		<section class={panel}>
			<h3 class="text-lg font-semibold">{t.keys}</h3>
			{#if data.keys.length}
				<ul class="space-y-2">
					{#each data.keys as key (key.id)}
						<li class="overflow-hidden rounded-xl border border-stone-200 bg-white">
							<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 sm:px-4">
								<div class="flex min-w-0 flex-1 basis-48 items-center gap-3">
									<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-stone-100 text-brand-800">
										<AdminIcon name="shield" class="size-5" />
									</span>
									<span class="min-w-0 break-words text-sm font-medium sm:text-base">{key.device_name}</span>
								</div>
								{#if data.recent}
									<div class="ml-auto flex shrink-0 items-center gap-1">
										<button type="button" id={`rename-key-${key.id}`} aria-expanded={editingKeyId === key.id}
											aria-label={`${t.renameKey} ${key.device_name}`}
											class={`${keyAction} ${editingKeyId === key.id ? 'bg-stone-200' : 'bg-stone-100 hover:bg-stone-200'} text-brand-800`}
											onclick={() => editingKeyId === key.id ? closeRename(key.id) : startRename(key.id)}>{t.renameKey}</button>
										<form method="POST" action="?/removePasskey" use:enhance>
											<input type="hidden" name="id" value={key.id} />
											<button type="submit" class={`${keyAction} text-stone-600 hover:bg-red-50 hover:text-red-800`}
												aria-label={`${t.remove} ${key.device_name}`}>{t.remove}</button>
										</form>
									</div>
								{/if}
							</div>
							{#if data.recent && editingKeyId === key.id}
								<form method="POST" action="?/renamePasskey" use:enhance={finishRename}
									class="flex flex-wrap items-end gap-3 border-t border-stone-200 bg-stone-50 px-3 py-3 sm:px-4">
									<input type="hidden" name="id" value={key.id} />
									<label class="min-w-0 flex-1 basis-56 text-sm font-medium">{t.editKeyName}
										<input class={`${input} min-h-11 bg-white`} bind:this={renameInput} name="name" value={key.device_name} maxlength="60" required />
									</label>
									<div class="ml-auto flex gap-2">
										<button type="button" class={button} onclick={() => closeRename(key.id)}>{t.cancel}</button>
										<button type="submit" class={submitButton}>{t.save}</button>
									</div>
								</form>
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
						<label class="block text-sm">{t.authenticatorAppChoice}
							<select class={input} name={authenticatorApp === 'other' ? undefined : 'appName'} bind:value={authenticatorApp}>
								<option value="">{t.authenticatorAppUnspecified}</option>
								<option>Google Authenticator</option>
								<option>Microsoft Authenticator</option>
								<option value="Apple Passwords">{t.applePasswords}</option>
								<option>1Password</option>
								<option>Bitwarden Authenticator</option>
								<option value="other">{t.authenticatorAppOther}</option>
							</select>
						</label>
						{#if authenticatorApp === 'other'}
							<label class="block text-sm">{t.authenticatorAppName}
								<input class={input} name="appName" maxlength="60" required />
							</label>
						{/if}
						<button type="submit" class={button}>{t.totpSetup}</button>
					</form>
				{/if}
			{/if}
		</section>
	</div>
{/if}
