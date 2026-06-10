<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
</script>

<svelte:head><title>{m.profile_title()}</title></svelte:head>

<div class="max-w-lg space-y-6">
	{#if form?.saved}
		<p class="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{m.profile_saved()}</p>
	{/if}
	{#if form?.message}
		<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{form.message}</p>
	{/if}

	<form method="POST" action="?/update" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
		<h2 class="font-medium text-brand-900">{m.profile_heading()}</h2>
		<div class="grid grid-cols-2 gap-3">
			<label class="block text-sm">
				<span class="text-stone-600">{m.profile_name()}</span>
				<input name="name" value={data.member.name} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
			</label>
			<label class="block text-sm">
				<span class="text-stone-600">{m.profile_kana()}</span>
				<input name="kana" value={data.member.kana} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
			</label>
		</div>
		<label class="block text-sm">
			<span class="text-stone-600">{m.profile_phone()}</span>
			<input name="phone" value={data.member.phone} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
		</label>
		<div class="text-sm">
			<span class="text-stone-600">{m.profile_email()}</span>
			<p class="mt-1 flex items-center justify-between rounded-md bg-stone-50 px-3 py-2">
				{data.member.email}
				<span class="text-xs text-stone-400">{m.profile_email_note()}</span>
			</p>
		</div>
		<label class="flex items-start gap-2 text-sm">
			<input type="checkbox" name="mailOptIn" checked={data.member.mailOptIn} class="mt-0.5 h-4 w-4" />
			<span>{m.profile_mail_opt_in()}</span>
		</label>
		<button type="submit" class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">{m.common_save()}</button>
	</form>

	<div class="rounded-2xl border border-stone-200 bg-white p-6 text-sm">
		<p class="text-stone-500">{m.profile_member_info({ code: data.member.memberCode, date: data.member.joinedAt })}</p>
		<form method="POST" action="/auth/logout" class="mt-4">
			<button type="submit" class="rounded-lg border border-stone-300 px-5 py-2 hover:bg-stone-50">{m.common_logout()}</button>
		</form>
	</div>

	<div class="rounded-2xl border border-stone-200 bg-white p-6 text-xs text-stone-500">
		<p class="font-medium text-stone-600">{m.profile_withdrawal()}</p>
		<p class="mt-1">{m.profile_withdrawal_note()}</p>
	</div>
</div>
