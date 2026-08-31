<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import MarkdownView from '$lib/components/MarkdownView.svelte';

	let { data, form } = $props();

	// チェックアウト日を滞在地（JST）の暦日で表示する
	const localeTag: Record<string, string> = { ja: 'ja-JP', en: 'en-US', 'zh-TW': 'zh-TW' };
	function fmtDate(iso: string): string {
		try {
			return new Intl.DateTimeFormat(localeTag[getLocale()] ?? 'ja-JP', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				timeZone: 'Asia/Tokyo'
			}).format(new Date(iso));
		} catch {
			return iso.slice(0, 10);
		}
	}

	// tel: リンク用（ハイフン等を除去）
	function telHref(phone?: string): string {
		return 'tel:' + (phone ?? '').replace(/[^0-9+]/g, '');
	}
</script>

<svelte:head><title>{m.inroom_header()} ｜ YAMADO</title></svelte:head>

{#if data.stay}
	<!-- ============ 滞在カード ============ -->
	<section class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
		<p class="font-display text-xl text-brand-900">
			{#if data.stay.guestName}
				{m.inroom_welcome({ name: data.stay.guestName })}
			{:else}
				{m.inroom_welcome_generic()}
			{/if}
		</p>
		<dl class="mt-4 space-y-2 text-sm">
			<div class="flex items-baseline justify-between border-b border-stone-100 pb-2">
				<dt class="text-stone-400">{m.inroom_room()}</dt>
				<dd class="font-medium text-stone-800">{data.stay.roomCode}</dd>
			</div>
			<div class="flex items-baseline justify-between border-b border-stone-100 pb-2">
				<dt class="text-stone-400">{m.inroom_checkout()}</dt>
				<dd class="font-medium text-stone-800">{fmtDate(data.stay.validTo)}</dd>
			</div>
			<div class="flex items-baseline justify-between">
				<dt class="text-stone-400">{m.common_facility()}</dt>
				<dd class="font-medium text-stone-800">{data.stay.facility.name}</dd>
			</div>
		</dl>
		{#if data.stay.facility.phone}
			<a
				href={telHref(data.stay.facility.phone)}
				class="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-800 py-3 text-sm font-medium text-white hover:bg-brand-700"
			>
				📞 {m.inroom_front_call()}（{data.stay.facility.phone}）
			</a>
		{/if}
	</section>

	<!-- ============ 貸切風呂のご予約 ============ -->
	<!-- 館内図の QR から来たお客様の主目的。館内案内より先に置く。 -->
	<a
		href="/r/bath"
		class="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-brand-800 bg-white py-3 text-sm font-medium text-brand-900 hover:bg-brand-50"
	>
		♨ {m.bath_link()}
	</a>

	<!-- ============ 館内案内 ============ -->
	<section class="mt-6">
		<h2 class="mb-2 px-1 font-display text-lg text-brand-900">{m.inroom_guides_title()}</h2>
		{#if data.guides.length === 0}
			<p class="rounded-xl border border-stone-200 bg-white px-4 py-6 text-center text-sm text-stone-400">
				{m.inroom_guides_empty()}
			</p>
		{:else}
			<div class="space-y-2">
				{#each data.guides as g (g.id)}
					<details class="group rounded-xl border border-stone-200 bg-white">
						<summary
							class="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-stone-800 marker:content-['']"
						>
							{g.title}
							<span class="text-stone-300 transition-transform group-open:rotate-180">▾</span>
						</summary>
						<div class="border-t border-stone-100 px-4 py-3 text-sm text-stone-700">
							<MarkdownView source={g.body} />
						</div>
					</details>
				{/each}
			</div>
		{/if}
	</section>
{:else}
	<!-- ============ 未 claim / 無効 / 終了：コード入力 ============ -->
	{#if data.invalidQr}
		<p class="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{m.inroom_err_invalid_qr()}</p>
	{:else if data.expired}
		<p class="mb-4 rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-600">{m.inroom_err_expired()}</p>
	{/if}

	{#if form?.claimError === 'fail'}
		<p class="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{m.inroom_err_code()}</p>
	{:else if form?.claimError === 'locked'}
		<p class="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{m.inroom_err_locked()}</p>
	{/if}

	<section class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
		<h1 class="font-display text-lg text-brand-900">{m.inroom_code_title()}</h1>
		<p class="mt-1 text-sm text-stone-500">{m.inroom_code_help()}</p>
		<form method="POST" action="?/claim" use:enhance class="mt-4 space-y-3">
			<input
				name="code"
				inputmode="numeric"
				pattern="[0-9]*"
				maxlength="8"
				autocomplete="one-time-code"
				placeholder={m.inroom_code_placeholder()}
				class="w-full rounded-xl border border-stone-300 px-4 py-3 text-center text-lg tracking-[0.3em] focus:border-accent-500 focus:outline-none"
			/>
			<button
				type="submit"
				class="w-full rounded-xl bg-brand-800 py-3 text-sm font-medium text-white hover:bg-brand-700"
			>
				{m.inroom_code_submit()}
			</button>
		</form>
	</section>
{/if}
