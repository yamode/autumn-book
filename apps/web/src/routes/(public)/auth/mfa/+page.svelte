<script lang="ts">
	import MemberPasskeyLogin from '$lib/components/MemberPasskeyLogin.svelte';
	import { getLocale } from '$lib/paraglide/runtime';
	import { memberLoginCopy } from '$lib/member-login-copy';
	import { enhance } from '$lib/enhance';

	let { data, form } = $props();
	const t = $derived(memberLoginCopy(getLocale()));
</script>

<svelte:head><title>{t.totp} ｜ YAMADO</title></svelte:head>
<div class="mx-auto max-w-md px-4 py-12">
	<h1 class="mb-5 text-center text-2xl text-brand-900">{t.totp}</h1>
	{#if data.unavailable}
		<p role="alert" class="text-sm text-red-700">{t.unavailable}</p>
	{:else}
		<form method="POST" use:enhance class="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
			<p class="text-sm text-stone-700">{t.totpHint}</p>
			{#if data.factors.length === 1}
				<input type="hidden" name="factorId" value={data.factors[0].id} />
			{:else}
				<select name="factorId" aria-label={t.totp} class="w-full rounded-md border border-stone-300 p-2">
					{#each data.factors as factor, index (factor.id)}
						<option value={factor.id}>{factor.name || `Authenticator ${index + 1}`}</option>
					{/each}
				</select>
			{/if}
			<label class="block text-sm">
				{t.code}
				<input class="mt-1 w-full rounded-md border border-stone-300 p-2 text-center tracking-widest" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required />
			</label>
			{#if form?.verified === false}<p role="alert" class="text-sm text-red-700">{t.wrongCode}</p>{/if}
			<button type="submit" class="w-full rounded-lg bg-brand-800 py-2.5 font-medium text-white hover:bg-brand-700">{t.verify}</button>
		</form>
	{/if}
	{#if data.passkeys}<div class="mt-4"><MemberPasskeyLogin next={data.next} /></div>{/if}
	<form method="POST" action="/auth/logout" class="mt-4">
		<button type="submit" class="min-h-11 text-sm text-stone-700 underline">{t.restart}</button>
	</form>
</div>
