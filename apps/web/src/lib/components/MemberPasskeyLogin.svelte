<script lang="ts">
	import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
	import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
	import { getLocale } from '$lib/paraglide/runtime';
	import { memberLoginCopy } from '$lib/member-login-copy';

	let { next }: { next: string } = $props();
	const t = $derived(memberLoginCopy(getLocale()));
	let busy = $state(false);
	let failed = $state(false);

	const submit = (body: Record<string, unknown>) => fetch('/auth/passkey', {
		method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
	});

	async function signIn() {
		if (busy) return;
		busy = true;
		failed = false;
		try {
			if (!browserSupportsWebAuthn()) throw new Error('unavailable');
			const optionsResponse = await submit({ action: 'options' });
			if (!optionsResponse.ok) throw new Error('options');
			const { challengeId, options } = await optionsResponse.json() as { challengeId: string; options: PublicKeyCredentialRequestOptionsJSON };
			const response = await startAuthentication({ optionsJSON: options });
			const result = await submit({ action: 'verify', challengeId, response, next });
			const body = await result.json();
			if (!result.ok || !body.ok || typeof body.next !== 'string') throw new Error('verification');
			window.location.assign(body.next);
		} catch {
			failed = true;
		} finally {
			busy = false;
		}
	}
</script>

<button type="button" class="w-full rounded-lg border border-brand-800 bg-white py-3 font-semibold text-brand-900 hover:bg-stone-50 disabled:opacity-60" disabled={busy} aria-busy={busy} data-pending={busy ? '' : undefined} onclick={signIn}>{t.passkey}</button>
{#if failed}<p role="alert" class="mt-2 text-sm text-red-700">{t.passkeyError}</p>{/if}
