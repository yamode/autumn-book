<script lang="ts">
	// マイページ → お支払いカード（保存カード・2026-10-07・docs/saved-cards.md §6.2）。
	// 一覧・追加（モーダル・StripePayment の mode='setup'・Apple Pay 等は出さない）・削除・既定。
	// ここでの同意はカードの「保存」の同意。お支払いはご予約ごとの画面で確認していただく。
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import StripePayment from '$lib/components/payment/StripePayment.svelte';
	import type { PaymentConfirmed, PaymentLocale, PaymentPrepareResult, PaymentTexts } from '$lib/components/payment/types';
	import { cardExpLabel, savedCardTitle } from '$lib/saved-cards';
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();

	let busy = $state(false);
	let notice = $state<{ ok: boolean; text: string } | null>(null);

	const resultText = (status: string | null | undefined): string =>
		status === 'saved'
			? m.account_cards_result_saved()
			: status === 'duplicate'
				? m.account_cards_result_duplicate()
				: status === 'expired'
					? m.account_cards_result_expired()
					: status === 'unpaid'
						? m.account_cards_result_unpaid()
						: m.account_cards_result_unknown();

	const submit =
		(confirmMessage?: string): SubmitFunction =>
		({ cancel }) => {
			if (confirmMessage && !confirm(confirmMessage)) {
				cancel();
				return;
			}
			busy = true;
			notice = null;
			return async ({ update }) => {
				busy = false;
				await update({ reset: false });
			};
		};

	const locale = getLocale();
	const dateLocale = locale === 'en' ? 'en-US' : locale === 'zh-TW' ? 'zh-TW' : 'ja-JP';
	const ymd = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(dateLocale, { timeZone: 'Asia/Tokyo' }) : '—');
	const stripeLocale: PaymentLocale = locale === 'en' || locale === 'zh-TW' ? locale : 'ja';
	const payTexts: PaymentTexts = {
		failed: m.pay_el_failed(),
		tryOtherCard: m.pay_el_try_other(),
		notReady: m.pay_el_not_ready(),
		checkCard: m.pay_el_check_card(),
		setupFailed: m.account_cards_result_unpaid(),
		loadFailed: m.pay_el_load_failed(),
		divider: m.pay_el_divider(),
		secure: m.pay_el_secure()
	};

	// ---- カードを追加する（モーダル）----
	let adding = $state(false);
	let payRef: StripePayment | undefined = $state();
	let payBusy = $state(false);

	function openAdd() {
		notice = null;
		adding = true;
	}
	function closeAdd() {
		if (payBusy) return;
		adding = false;
	}

	async function prepareAdd(): Promise<PaymentPrepareResult> {
		const res = await fetch('/account/cards/api', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'prepare' })
		});
		const j = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; clientSecret?: string; returnUrl?: string } | null;
		if (!res.ok || !j?.ok || !j.clientSecret || !j.returnUrl) throw new Error(j?.message || m.account_cards_error());
		return { clientSecret: j.clientSecret, returnUrl: j.returnUrl };
	}

	async function onAdded(r: PaymentConfirmed) {
		let status: string | undefined;
		try {
			const res = await fetch('/account/cards/api', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'confirm', intentId: r.intentId })
			});
			const j = (await res.json().catch(() => null)) as { result?: { status?: string } } | null;
			status = j?.result?.status;
		} catch {
			// 一覧の読み直しで確かめてもらう
		}
		notice = { ok: status === 'saved', text: resultText(status) };
		adding = false;
		await invalidateAll();
	}
</script>

<svelte:head>
	<title>{m.account_nav_cards()}</title>
</svelte:head>

<section class="max-w-3xl">
	<p class="text-sm leading-6 text-stone-600">{m.account_cards_intro()}</p>

	{#if data.state !== 'ready'}
		<p class="mt-5 rounded-lg border border-amber-700/30 bg-amber-50 px-4 py-6 text-center text-sm text-amber-800">{m.account_cards_unavailable()}</p>
	{:else}
		{#if form?.message}
			<p class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{form.message}</p>
		{:else if form?.removed}
			<p class="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{m.account_cards_removed({ card: form.removed })}</p>
		{:else if form?.defaulted}
			<p class="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{m.account_cards_defaulted({ card: form.defaulted })}</p>
		{/if}
		{#if notice ?? data.returned}
			{@const n = notice ?? { ok: data.returned === 'saved', text: resultText(data.returned) }}
			<p class="mt-4 rounded-lg px-4 py-3 text-sm {n.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}" role="status">{n.text}</p>
		{/if}
		{#if data.loadError}
			<p class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{m.account_cards_load_failed()}</p>
		{/if}

		{#if data.cards.length === 0}
			{#if !data.loadError}
				<p class="mt-5 rounded-lg border border-stone-200 px-4 py-8 text-center text-stone-500">{m.account_cards_empty()}</p>
			{/if}
		{:else}
			<ul class="mt-5 space-y-3">
				{#each data.cards as c (c.id)}
					<li class="rounded-lg border border-stone-200 bg-white p-4">
						<div class="flex flex-wrap items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="flex flex-wrap items-center gap-2">
									<span class="font-medium text-brand-900">{savedCardTitle(c)}</span>
									{#if c.isDefault}<span class="rounded bg-brand-800/10 px-1.5 py-0.5 text-xs font-medium text-brand-800">{m.account_cards_default_badge()}</span>{/if}
								</p>
								<p class="mt-1 text-sm text-stone-600">
									{m.account_cards_exp({ exp: cardExpLabel(c.expMonth, c.expYear) })}
									<span class="ml-3 text-stone-500">{m.account_cards_added_on({ date: ymd(c.created) })}</span>
								</p>
							</div>
							<div class="flex flex-wrap gap-2 text-sm">
								{#if !c.isDefault}
									<form method="POST" action="?/set_default" use:enhance={submit()}>
										<input type="hidden" name="pm" value={c.id} />
										<button type="submit" disabled={busy} class="rounded-md border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-50 disabled:opacity-50">{m.account_cards_set_default()}</button>
									</form>
								{/if}
								<form method="POST" action="?/remove" use:enhance={submit(m.account_cards_remove_confirm({ card: savedCardTitle(c) }))}>
									<input type="hidden" name="pm" value={c.id} />
									<button type="submit" disabled={busy} class="rounded-md border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50">{m.account_cards_remove()}</button>
								</form>
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<button type="button" onclick={openAdd} disabled={!data.stripeKey} class="mt-5 rounded-lg bg-brand-800 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50">
			{m.account_cards_add()}
		</button>
	{/if}
</section>

{#if adding}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="presentation" onclick={(e) => e.target === e.currentTarget && closeAdd()} onkeydown={(e) => e.key === 'Escape' && closeAdd()}>
		<div class="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="member-card-add-title">
			<div class="flex items-start justify-between gap-3">
				<h2 id="member-card-add-title" class="text-lg font-bold">{m.account_cards_add()}</h2>
				<button type="button" onclick={closeAdd} disabled={payBusy} class="rounded-md px-2 py-1 text-stone-500 hover:bg-stone-100" aria-label={m.account_cards_close()}>✕</button>
			</div>
			<div class="mt-4">
				<StripePayment
					bind:this={payRef}
					publishableKey={data.stripeKey}
					mode="setup"
					express={false}
					locale={stripeLocale}
					texts={payTexts}
					unavailableText={m.account_cards_unavailable()}
					consentText={m.account_cards_consent()}
					allowRedisplay="always"
					prepare={prepareAdd}
					onconfirmed={onAdded}
					onbusychange={(v) => (payBusy = v)}
				/>
			</div>
			<p class="mt-3 text-xs leading-5 text-stone-500">{m.account_cards_consent_note()}</p>
			<button type="button" onclick={() => void payRef?.submit()} disabled={payBusy || !data.stripeKey} class="mt-4 w-full rounded-lg bg-brand-800 px-4 py-3 font-medium text-white transition hover:bg-brand-700 disabled:opacity-40">
				{payBusy ? m.account_cards_saving() : m.account_cards_save_button()}
			</button>
			<button type="button" onclick={closeAdd} disabled={payBusy} class="mt-2 w-full rounded-lg border border-stone-300 px-4 py-2.5 text-sm hover:bg-stone-50">{m.account_cards_close()}</button>
		</div>
	</div>
{/if}
