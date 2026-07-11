<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';
	import OtayoriCta from '$lib/components/OtayoriCta.svelte';

	let { data, form } = $props();

	// 入力復元値（バリデーションエラー時のみ存在）。union の絞り込みを回避して安全に取り出す。
	let bodyValue = $derived(form && 'body' in form ? (form.body ?? '') : '');
	let radioValue = $derived(form && 'radioName' in form ? (form.radioName ?? '') : '');
</script>

<svelte:head><title>{m.otayori_form_title()} ｜ 山人</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-10">
	<h1 class="font-display mb-1 text-2xl text-brand-900">{m.otayori_form_title()}</h1>
	<p class="mb-6 text-sm text-stone-500">{m.otayori_form_intro()}</p>

	{#if form?.submitted}
		<!-- 送信後のサンクス表示（設計書 §6） -->
		<div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
			<h2 class="font-display text-lg text-emerald-900">{m.otayori_thanks_title()}</h2>
			<p class="mt-2 text-sm text-emerald-800">{m.otayori_thanks_body()}</p>
			<div class="mt-4 flex flex-wrap gap-2">
				<a href="/otayori" class="rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">{m.otayori_thanks_again()}</a>
				<a href="/account/points" class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">{m.otayori_thanks_mypage()}</a>
			</div>
		</div>
	{:else if !data.isLoggedIn}
		<!-- 未ログイン：会員登録 CTA（投稿フォームは出さない） -->
		<OtayoriCta showBanner={true} />
	{:else if data.role !== 'member'}
		<!-- staff / admin：運営アカウント案内 -->
		<p class="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-5 text-sm text-stone-600">{m.otayori_staff_no_post()}</p>
	{:else}
		<!-- member：投稿フォーム -->
		<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{m.otayori_form_award_note()}</p>

		{#if form?.message}
			<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
		{/if}

		<form method="POST" action="?/submit" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
			<label class="block text-sm">
				<span class="text-stone-600">{m.otayori_body_label()}</span>
				<textarea name="body" rows="6" required maxlength="2000" placeholder={m.otayori_body_ph()} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm">{bodyValue}</textarea>
			</label>
			<label class="block text-sm">
				<span class="text-stone-600">{m.otayori_radio_label()}</span>
				<input name="radioName" value={radioValue} maxlength="40" placeholder={m.otayori_radio_ph()} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
			</label>
			<button type="submit" class="w-full rounded-lg bg-brand-800 py-2.5 font-medium text-white hover:bg-brand-700">{m.otayori_submit()}</button>
		</form>
	{/if}
</div>
