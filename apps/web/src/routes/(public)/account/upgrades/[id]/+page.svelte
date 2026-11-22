<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { invalidateAll } from '$app/navigation';
	import StripePayment from '$lib/components/payment/StripePayment.svelte';
	import type { PaymentLocale, PaymentTexts } from '$lib/components/payment/types';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { upgradeStatusLabel } from '$lib/room-upgrades';
	let { data, form } = $props();
	let busy = $state(false);
	let agreed = $state(false);
	let paymentUi: { submit: () => Promise<boolean> } | undefined = $state();
	let paymentError = $state('');
	const offer = $derived(data.offer);
	const canAccept = $derived(offer.status === 'offered' && offer.eligible && (offer.remaining > 0 || offer.has_payment_hold));
	const paymentLabel = $derived(offer.payment_mode === 'online' ? m.upgrade_payment_online() : m.upgrade_payment_onsite());
	// 表示言語に合わせた日時の書式（日本時間で出す）
	const locale = getLocale();
	const dateLocale = locale === 'en' ? 'en-US' : locale === 'zh-TW' ? 'zh-TW' : 'ja-JP';
	const deadline = $derived(new Date(offer.expires_at).toLocaleString(dateLocale, { timeZone: 'Asia/Tokyo' }));
	// 決済部品の言語と文言（他の公式サイトの画面と同じく m.* を渡す）
	const stripeLocale: PaymentLocale = locale === 'en' || locale === 'zh-TW' ? locale : 'ja';
	const payTexts: PaymentTexts = {
		failed: m.pay_el_failed(),
		tryOtherCard: m.pay_el_try_other(),
		notReady: m.pay_el_not_ready(),
		checkCard: m.pay_el_check_card(),
		setupFailed: m.pay_el_failed(),
		loadFailed: m.pay_el_load_failed(),
		divider: m.pay_el_divider(),
		secure: m.pay_el_secure()
	};
	async function payRequest(action: string, intentId?: string) {
		const fd = new FormData(); fd.set('action', action); fd.set('total', String(offer.total)); fd.set('consent', agreed ? 'yes' : 'no'); if (intentId) fd.set('intentId', intentId);
		const response = await fetch(`/account/upgrades/${offer.id}/pay`, { method: 'POST', body: fd });
		const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.message || m.upgrade_pay_check_failed()); return result;
	}
</script>
<svelte:head><title>{m.upgrade_detail_page_title({ title: offer.title })}</title></svelte:head>
<a href="/account/upgrades" class="text-sm text-brand-800 hover:underline">{m.upgrade_back_to_list()}</a>
<p class="mt-5 text-sm text-stone-500">{m.upgrade_booking_ref({ facility: offer.facility_name, code: offer.booking_code, n: String(offer.room_index) })}</p>
<h2 class="mt-2 text-2xl text-brand-900">{offer.title}</h2>
{#if form?.message}<p role="status" class="mt-4 rounded-lg p-4 {form.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}">{form.message}</p>{/if}
{#if paymentError}<p role="alert" class="mt-4 rounded-lg bg-red-50 p-4 text-red-700">{paymentError}</p>{/if}
{#if data.paymentResult === 'refunded'}<p role="status" class="mt-4 rounded-lg bg-amber-50 p-4">{m.upgrade_result_refunded()}</p>{/if}
{#if data.paymentResult === 'pending' && offer.status !== 'accepted'}<p role="status" class="mt-4 rounded-lg bg-amber-50 p-4">{m.upgrade_result_pending()}</p>{/if}
<div class="mt-5 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
	<p class="text-sm">{m.upgrade_stay_summary({ checkin: offer.checkin, checkout: offer.checkout, adults: String(offer.adults) })}</p>
	<div class="mt-4 grid gap-3 sm:grid-cols-2">
		<div class="rounded-xl bg-stone-50 p-4"><p class="text-xs text-stone-500">{m.upgrade_current_room()}</p><p class="mt-1 font-semibold">{offer.source_name}</p></div>
		<div class="rounded-xl bg-amber-50 p-4"><p class="text-xs text-stone-500">{m.upgrade_after_room()}</p><p class="mt-1 font-semibold text-brand-900">{offer.target_name ?? m.upgrade_target_unpublished()}</p>{#if offer.target_area}<p class="mt-1 text-sm">{offer.target_area}㎡</p>{/if}</div>
	</div>
	{#if offer.target_photos?.length}<div class="mt-4 grid gap-3 sm:grid-cols-2">{#each offer.target_photos.slice(0, 4) as photo}<img src={photo.url} alt={photo.caption ?? offer.target_name} class="aspect-[4/3] w-full rounded-xl object-cover" loading="lazy" />{/each}</div>{/if}
	{#if offer.description}<p class="mt-5 whitespace-pre-line leading-7 text-stone-700">{offer.description}</p>{/if}
	{#if offer.target_description}<p class="mt-4 whitespace-pre-line text-sm leading-7 text-stone-600">{offer.target_description}</p>{/if}
	{#if offer.target_amenities?.length}<p class="mt-3 text-sm text-stone-500">{offer.target_amenities.join(' ／ ')}</p>{/if}
	<div class="mt-6 rounded-xl bg-stone-50 p-4">
		<p class="text-sm">{offer.price_basis === 'night' ? m.upgrade_unit_per_night({ amount: offer.unit_amount.toLocaleString() }) : m.upgrade_unit_per_stay({ amount: offer.unit_amount.toLocaleString() })}</p>
		<p class="mt-1 text-xl font-semibold text-brand-900">{m.upgrade_total_label({ amount: offer.total.toLocaleString() })}<span class="ml-1 text-sm font-normal">{m.upgrade_total_tax_payment({ payment: paymentLabel })}</span></p>
		<p class="mt-2 text-sm text-stone-600">{m.upgrade_terms_unchanged()}</p>
		<p class="mt-2 text-sm text-stone-600">{m.upgrade_terms_payment({ base: offer.base_total.toLocaleString(), amount: offer.total.toLocaleString() })}</p>
	</div>
	{#if offer.status === 'accepted'}
		<p class="mt-5 rounded-xl bg-emerald-50 p-4 text-emerald-800">{m.upgrade_accepted_note({ payment: offer.payment_mode === 'online' ? m.upgrade_accepted_paid_online() : m.upgrade_accepted_pay_onsite() })}</p>
	{:else if canAccept}
		<p class="mt-5 text-sm text-stone-600">{m.upgrade_deadline({ deadline })}</p>
		<p class="mt-2 text-sm text-stone-500">{m.upgrade_not_reserved_yet()}</p>
		{#if offer.payment_mode === 'online'}
			<div class="mt-5"><StripePayment bind:this={paymentUi} publishableKey={data.stripeKey} mode="payment" amount={offer.total} express={false}
				locale={stripeLocale} texts={payTexts} unavailableText={m.pay_unavailable()}
				validate={() => agreed ? null : m.upgrade_consent_needed()} prepare={() => payRequest('prepare')}
				onconfirmed={async (r) => { await payRequest('confirm', r.intentId); await invalidateAll(); }} onerror={(message) => paymentError = message} onbusychange={(value) => busy = value} /></div>
			<label class="mt-4 flex items-start gap-3 text-sm leading-6"><input type="checkbox" required bind:checked={agreed} disabled={busy} class="mt-1" /><span>{m.upgrade_consent_online({ amount: offer.total.toLocaleString() })}</span></label>
			<button disabled={!agreed || busy || !data.stripeKey} onclick={() => paymentUi?.submit()} class="mt-4 w-full rounded-lg bg-brand-800 px-5 py-3 text-white disabled:opacity-40">{busy ? m.upgrade_paying() : m.upgrade_pay_submit()}</button>
		{:else}
		<form method="POST" action="?/accept" class="mt-5" use:enhance={() => { busy = true; return async ({ update }) => { try { await update(); } finally { busy = false; } }; }}>
			<input type="hidden" name="total" value={offer.total} />
			<label class="flex items-start gap-3 text-sm leading-6"><input type="checkbox" name="consent" value="yes" required bind:checked={agreed} disabled={busy} class="mt-1" /><span>{m.upgrade_consent_onsite({ amount: offer.total.toLocaleString() })}</span></label>
			<button disabled={!agreed || busy} class="mt-4 w-full rounded-lg bg-brand-800 px-5 py-3 text-white disabled:opacity-40">{busy ? m.upgrade_checking_rooms() : m.upgrade_accept_submit()}</button>
		</form>
		{/if}
		<form method="POST" action="?/decline" use:enhance class="mt-3"><button disabled={busy} class="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-600">{m.upgrade_decline()}</button></form>
	{:else}
		<p class="mt-5 rounded-xl bg-stone-100 p-4 text-stone-600">{offer.status === 'offered' ? offer.eligible && offer.remaining === 0 ? m.upgrade_sold_out_note() : m.upgrade_closed_note() : upgradeStatusLabel(offer.status)}</p>
	{/if}
</div>
