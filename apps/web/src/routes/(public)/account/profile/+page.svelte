<script lang="ts">
	import { enhance } from '$lib/enhance';
	import type { SubmitFunction } from '@sveltejs/kit';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
	let avatarBusy = $state(false);

	function selectAvatar(event: Event & { currentTarget: HTMLInputElement }) {
		if (event.currentTarget.files?.length) event.currentTarget.form?.requestSubmit();
	}

	const submitAvatar: SubmitFunction = ({ cancel }) => {
		if (avatarBusy) return cancel();
		avatarBusy = true;
		return async ({ update, formElement }) => {
			try { await update(); }
			finally { formElement.reset(); avatarBusy = false; }
		};
	};

	// 退会セクションの開閉
	let withdrawOpen = $state(false);
</script>

<svelte:head><title>{m.profile_title()}</title></svelte:head>

<div class="grid items-start gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] lg:gap-6">
	{#if form?.saved}
		<p role="status" class="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 lg:col-span-2">{m.profile_saved()}</p>
	{/if}
	{#if form?.message}
		<p role="alert" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 lg:col-span-2">{form.message}</p>
	{/if}

	<!-- プロフィール画像 -->
	<section class="min-w-0 space-y-3 rounded-2xl border border-stone-200 bg-white p-4 sm:p-6"
		aria-labelledby="profile-avatar-heading" aria-busy={avatarBusy}>
		<h2 id="profile-avatar-heading" class="text-lg">{m.profile_avatar_heading()}</h2>
		<p class="text-sm text-stone-500">{m.profile_avatar_note()}</p>
		{#if form?.avatarSaved}
			<p role="status" class="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{m.profile_avatar_saved()}</p>
		{/if}
		{#if form?.avatarError}
			<p role="alert" class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{form.avatarError}</p>
		{/if}
		<div class="flex items-center gap-4">
			{#if data.member.avatarUrl}
				<img src={data.member.avatarUrl} alt="" class="size-16 shrink-0 rounded-full object-cover sm:size-20" />
			{:else}
				<div aria-hidden="true" class="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand-800 text-3xl font-semibold text-white sm:size-20">
					{(data.member.name ?? '').trim().charAt(0) || '·'}
				</div>
			{/if}
			<div class="min-w-0 space-y-1.5">
				<form method="POST" action="?/uploadAvatar" enctype="multipart/form-data" use:enhance={submitAvatar}>
					<input id="profile-avatar" type="file" name="avatar" accept="image/*" required
						disabled={avatarBusy} onchange={selectAvatar} class="peer sr-only" />
					<label for="profile-avatar" class="inline-flex min-h-11 cursor-pointer items-center rounded-lg bg-brand-800 px-3 py-2 text-center text-sm font-medium text-white hover:bg-brand-700 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-800 peer-disabled:cursor-wait peer-disabled:opacity-60 sm:px-4">
						{avatarBusy ? m.profile_avatar_saving() : data.member.avatarUrl ? m.profile_avatar_change() : m.profile_avatar_select()}
					</label>
					<noscript><button type="submit" class="mt-2 block text-sm underline">{m.profile_avatar_upload()}</button></noscript>
				</form>
				{#if data.member.avatarUrl}
					<form method="POST" action="?/removeAvatar" use:enhance={submitAvatar}>
						<button type="submit" disabled={avatarBusy} class="inline-flex min-h-8 items-center text-sm text-stone-500 underline hover:text-red-600 disabled:opacity-60">{m.profile_avatar_remove()}</button>
					</form>
				{/if}
			</div>
		</div>
	</section>

	<!-- 基本情報（グローバル正規化: 姓 / 名 / ミドルネーム + カナ） -->
	<form method="POST" action="?/update" use:enhance class="min-w-0 space-y-4 rounded-2xl border border-stone-200 bg-white p-4 sm:p-6 lg:col-start-2 lg:row-span-2">
		<h2 class="text-lg">{m.profile_heading()}</h2>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="text-sm text-stone-600">{m.name_family()} <span class="text-red-500">*</span></span>
				<input name="familyName" value={data.member.familyName} required class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" />
			</label>
			<label class="block">
				<span class="text-sm text-stone-600">{m.name_given()} <span class="text-red-500">*</span></span>
				<input name="givenName" value={data.member.givenName} required class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" />
			</label>
		</div>
		<label class="block">
			<span class="text-sm text-stone-600">{m.name_middle()} <span class="text-xs text-stone-400">{m.name_optional()}</span></span>
			<input name="middleName" value={data.member.middleName} class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" />
		</label>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class="text-sm text-stone-600">{m.name_family_kana()}</span>
				<input name="familyNameKana" value={data.member.familyNameKana} class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" />
			</label>
			<label class="block">
				<span class="text-sm text-stone-600">{m.name_given_kana()}</span>
				<input name="givenNameKana" value={data.member.givenNameKana} class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5" />
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
	<div class="min-w-0 space-y-3 rounded-2xl border border-stone-200 bg-white p-4 sm:p-6">
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
		<p class="wrap-anywhere rounded-lg bg-stone-50 px-3 py-2.5 text-[15px] text-stone-700">{data.member.email}</p>
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
	<div class="rounded-2xl border border-stone-200 bg-white p-4 sm:p-6 lg:col-span-2">
		<p class="text-[15px] text-stone-500">{m.profile_member_info({ code: data.member.memberCode, date: data.member.joinedAt })}</p>
	</div>

	<!-- 退会 -->
	<div class="rounded-2xl border border-red-200 bg-white p-4 sm:p-6 lg:col-span-2">
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
