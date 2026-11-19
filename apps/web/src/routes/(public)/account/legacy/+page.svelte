<script lang="ts">
	// 以前の会員のご利用実績を引き継ぐ（既に会員の人）
	import { enhance } from '$lib/enhance';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
	const done = $derived(form && 'done' in form ? (form.done as string) : '');
	const message = $derived(form && 'message' in form ? (form.message as string) : '');
</script>

<svelte:head><title>{m.migrate_claim_title()}</title></svelte:head>

<div class="mx-auto max-w-md px-4 py-8">
	<h1 class="font-display mb-4 text-xl text-brand-900">{m.migrate_claim_title()}</h1>

	{#if done === 'linked'}
		<p class="rounded-lg bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900" role="status">{m.migrate_claim_linked()}</p>
	{:else if done === 'pending_review'}
		<p class="rounded-lg bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900" role="status">{m.migrate_claim_pending()}</p>
	{:else if done}
		<p class="rounded-lg bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700" role="status">{m.migrate_claim_none()}</p>
	{:else if !data.open || !data.claimable}
		<p class="rounded-lg bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700">{m.migrate_claim_none()}</p>
	{:else}
		<p class="mb-4 text-sm leading-6 text-stone-600">{m.migrate_claim_lead()}</p>
		{#if message}<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{message}</p>{/if}
		<form method="POST" action="?/claim" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
			<label class="block text-sm">
				<span class="text-stone-600">{m.register_phone()} <span class="text-red-500">*</span></span>
				<input type="tel" name="phone" autocomplete="tel" required value={form && 'phone' in form ? (form.phone as string) : ''} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder="09000000000" />
				<span class="mt-1 block text-xs text-stone-500">{data.phoneLast4 ? m.migrate_phone_hint_last4({ last4: data.phoneLast4 }) : m.migrate_phone_hint()}</span>
			</label>
			<label class="flex cursor-pointer items-start gap-2 text-sm">
				<input type="checkbox" name="privacyConsent" required class="mt-0.5 h-4 w-4 shrink-0" />
				<span class="text-stone-700"><a href="/legal/privacy" target="_blank" rel="noopener" class="underline">{m.register_privacy_link()}</a>{m.migrate_consent_post()}</span>
			</label>
			<button type="submit" class="w-full rounded-lg bg-accent-600 py-2.5 font-medium text-white hover:bg-accent-500">{m.migrate_claim_submit()}</button>
			<p class="text-center text-xs text-stone-500">{m.migrate_rank_note()}</p>
		</form>
	{/if}
	<p class="mt-6 text-sm"><a href="/account" class="text-accent-600 underline">{m.migrate_back_mypage()}</a></p>
</div>
