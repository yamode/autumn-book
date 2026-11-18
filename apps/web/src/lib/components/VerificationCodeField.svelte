<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { memberLoginCopy } from '$lib/member-login-copy';
	import { getLocale } from '$lib/paraglide/runtime';

	let { sms = false }: { sms?: boolean } = $props();
	let input: HTMLInputElement;
	const hintId = $props.id();
	const digits = $derived(sms ? 6 : 8);
	const t = $derived(memberLoginCopy(getLocale()));

	onMount(() => {
		input.focus();
		if (!sms || !('OTPCredential' in window) || !navigator.credentials) return;
		const controller = new AbortController();
		const timer = window.setTimeout(() => controller.abort(), 90_000);
		const options = { otp: { transport: ['sms'] }, signal: controller.signal } as CredentialRequestOptions;
		void navigator.credentials.get(options).then((credential) => {
			const code = (credential as (Credential & { code?: string }) | null)?.code;
			if (!input.value && code && /^\d{6}$/.test(code)) input.value = code;
		}).catch(() => {});
		return () => {
			controller.abort();
			window.clearTimeout(timer);
		};
	});

	function pasteCode(event: ClipboardEvent) {
		const code = event.clipboardData?.getData('text').normalize('NFKC').replace(/\s+/g, '');
		if (!code || code.length !== digits || !/^\d+$/.test(code)) return;
		event.preventDefault();
		input.value = code;
	}
</script>

<div>
	<label class="block text-sm">
		<span class="text-stone-600">{sms ? t.smsCodeLabel : m.auth_otp_code_label()}</span>
		<input bind:this={input} type="text" name="token" inputmode="numeric" autocomplete="one-time-code"
			autocapitalize="off" spellcheck={false} maxlength={digits} required placeholder={sms ? undefined : m.auth_otp_code_placeholder()}
			aria-describedby={hintId} onpaste={pasteCode}
			class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-center text-lg tracking-[0.4em]" />
	</label>
	<p id={hintId} class="mt-2 text-sm text-stone-600">{sms ? t.smsCodeHint : m.auth_otp_autofill_hint()}</p>
</div>
