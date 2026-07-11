<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();

	// 退会セクションの開閉
	let withdrawOpen = $state(false);
</script>

<svelte:head><title>{m.profile_title()}</title></svelte:head>

<div class="max-w-lg space-y-6">
	{#if form?.saved}
		<p class="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{m.profile_saved()}</p>
	{/if}
	{#if form?.message}
		<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{form.message}</p>
	{/if}

	<!-- 基本情報 -->
	<form method="POST" action="?/update" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
		<h2 class="text-lg">{m.profile_heading()}</h2>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="text-sm text-stone-600">{m.profile_name()}</span>
				<input name="name" value={data.member.name} class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" />
			</label>
			<label class="block">
				<span class="text-sm text-stone-600">{m.profile_kana()}</span>
				<input name="kana" value={data.member.kana} class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" />
			</label>
		</div>
		<label class="block">
			<span class="text-sm text-stone-600">{m.profile_phone()}</span>
			<input name="phone" value={data.member.phone} class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" />
		</label>
		<label class="flex items-start gap-2.5">
			<input type="checkbox" name="mailOptIn" checked={data.member.mailOptIn} class="mt-1 h-4 w-4" />
			<span class="text-[15px]">{m.profile_mail_opt_in()}</span>
		</label>
		<button type="submit" class="rounded-lg bg-brand-800 px-6 py-2.5 font-medium text-white hover:bg-brand-700">{m.common_save()}</button>
	</form>

	<!-- メールアドレス変更 -->
	<div class="space-y-3 rounded-2xl border border-stone-200 bg-white p-6">
		<h2 class="text-lg">{m.profile_email()}</h2>
		{#if form?.emailSaved}
			<p class="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{m.profile_email_saved()}</p>
		{/if}
		{#if form?.emailPending}
			<p class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{m.profile_email_pending({ email: form.pendingEmail })}</p>
		{/if}
		{#if form?.emailError}
			<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{form.emailError}</p>
		{/if}
		<p class="rounded-lg bg-stone-50 px-3 py-2.5 text-[15px] text-stone-700">{data.member.email}</p>
		<form method="POST" action="?/changeEmail" use:enhance class="space-y-3">
			<label class="block">
				<span class="text-sm text-stone-600">{m.profile_email_new_label()}</span>
				<input type="email" name="email" required placeholder="new@example.com" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" />
			</label>
			<p class="text-sm text-stone-400">{m.profile_email_change_note()}</p>
			<button type="submit" class="rounded-lg border border-brand-800 px-5 py-2 text-sm font-medium text-brand-800 hover:bg-brand-50">{m.profile_email_change_button()}</button>
		</form>
	</div>

	<!-- 会員情報 -->
	<div class="rounded-2xl border border-stone-200 bg-white p-6">
		<p class="text-[15px] text-stone-500">{m.profile_member_info({ code: data.member.memberCode, date: data.member.joinedAt })}</p>
	</div>

	<!-- 退会 -->
	<div class="rounded-2xl border border-red-200 bg-white p-6">
		<h2 class="text-base text-red-700">{m.profile_withdrawal()}</h2>
		<p class="mt-1 text-sm text-stone-500">{m.profile_withdrawal_note()}</p>
		{#if !withdrawOpen}
			<button type="button" onclick={() => (withdrawOpen = true)} class="mt-3 text-sm font-medium text-red-600 underline hover:text-red-700">
				{m.profile_withdraw_open()}
			</button>
		{:else}
			<div class="mt-4 rounded-xl bg-red-50 p-4">
				<p class="text-sm text-red-800">{m.profile_withdraw_warning()}</p>
				{#if form?.withdrawError}
					<p class="mt-2 rounded-lg bg-white px-3 py-2 text-sm text-red-700">{form.withdrawError}</p>
				{/if}
				<form method="POST" action="?/withdraw" use:enhance class="mt-3 space-y-3">
					<label class="block">
						<span class="text-sm text-stone-600">{m.profile_withdraw_confirm_label({ keyword: m.profile_withdraw_keyword() })}</span>
						<input name="confirm" required autocomplete="off" class="mt-1 w-full rounded-lg border border-red-300 px-3 py-2.5" />
					</label>
					<div class="flex gap-2">
						<button type="submit" class="rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700">{m.profile_withdraw_button()}</button>
						<button type="button" onclick={() => (withdrawOpen = false)} class="rounded-lg border border-stone-300 px-5 py-2 text-sm hover:bg-stone-50">{m.common_cancel()}</button>
					</div>
				</form>
			</div>
		{/if}
	</div>
</div>
