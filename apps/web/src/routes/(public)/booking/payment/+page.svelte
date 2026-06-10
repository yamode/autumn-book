<script lang="ts">
	import { enhance } from '$app/forms';
	import Stepper from '$lib/components/Stepper.svelte';
	import HoldTimer from '$lib/components/HoldTimer.svelte';
	import PriceBreakdown from '$lib/components/PriceBreakdown.svelte';
	import { formatPrice, formatDateLong } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
	let expiredNow = $state(false);
	let paying = $state(false);

	let steps = [m.steps_plan(), m.steps_info(), m.steps_payment(), m.steps_complete()];
</script>

<svelte:head><title>{m.payment_title()}</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-8">
	{#if data.expired || expiredNow}
		<div class="rounded-2xl border border-stone-200 bg-white p-8 text-center">
			<h1 class="font-display text-xl text-brand-900">{m.payment_expired_heading()}</h1>
			<p class="mt-2 text-sm text-stone-600">{m.payment_expired_msg()}</p>
			<a href="/search" class="mt-4 inline-block rounded-lg bg-brand-800 px-6 py-2 text-sm text-white">{m.payment_expired_search()}</a>
		</div>
	{:else}
		<Stepper {steps} current={2} />

		<div class="mt-6"><HoldTimer expiresAt={data.hold.expiresAt} onexpire={() => (expiredNow = true)} /></div>

		{#if form?.message}
			<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
		{/if}

		<div class="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
			<h1 class="font-display text-lg text-brand-900">{m.payment_heading()}</h1>
			<p class="mt-1 text-sm text-stone-500">{m.payment_facility_dates({ facility: data.facility.name, date: formatDateLong(data.hold.checkin), nights: String(data.hold.nights) })}</p>

			<div class="mt-4 rounded-lg bg-stone-50 p-4">
				<PriceBreakdown quote={data.hold.quote} showLines={false} />
				{#if data.discountAmount > 0}
					<div class="mt-2 flex justify-between border-t border-stone-200 pt-2 text-sm text-red-600">
						<span>{m.pay_discount_line({ rate: String(Math.round(data.discountRate * 100)) })}</span>
						<span>-{formatPrice(data.discountAmount)}</span>
					</div>
					<div class="mt-1 flex justify-between text-base font-bold">
						<span>{m.payment_heading()}</span>
						<span>{formatPrice(data.payableTotal)}</span>
					</div>
				{/if}
				<p class="mt-2 text-xs text-stone-400">{m.pay_prepay_note()}</p>
			</div>

			{#if data.method === 'paypay'}
				<!-- PayPay デモ（本実装: PayPay for Developers / Stripe 経由。QR or アプリ遷移） -->
				<div class="mt-5 rounded-xl border border-dashed border-stone-300 p-4 text-center">
					<p class="text-xs font-medium text-stone-400">{m.payment_demo_label()}</p>
					<div class="mx-auto mt-3 flex h-36 w-36 items-center justify-center rounded-xl border-4 border-[#ff0033] bg-white">
						<span class="text-2xl font-black tracking-tight text-[#ff0033]">PayPay</span>
					</div>
					<p class="mt-3 text-sm text-stone-500">本番では PayPay アプリ／QRコードでのお支払いに遷移します</p>
				</div>
			{:else}
				<!-- Stripe Payment Element 設置位置（P4 で本実装・カード情報は Stripe 直収） -->
				<div class="mt-5 space-y-3 rounded-xl border border-dashed border-stone-300 p-4">
					<p class="text-xs font-medium text-stone-400">{m.payment_demo_label()}</p>
					<label class="block text-sm">
						<span class="text-stone-600">{m.payment_card_number()}</span>
						<input value="4242 4242 4242 4242" readonly class="mt-1 w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 font-mono" />
					</label>
					<div class="grid grid-cols-2 gap-3">
						<label class="block text-sm">
							<span class="text-stone-600">{m.payment_expiry()}</span>
							<input value="12/28" readonly class="mt-1 w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 font-mono" />
						</label>
						<label class="block text-sm">
							<span class="text-stone-600">{m.payment_cvc()}</span>
							<input value="424" readonly class="mt-1 w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 font-mono" />
						</label>
					</div>
				</div>
			{/if}

			<form
				method="POST"
				action="?/pay"
				use:enhance={() => {
					paying = true;
					return async ({ update }) => {
						paying = false;
						await update();
					};
				}}
				class="mt-5"
			>
				<input type="hidden" name="holdId" value={data.hold.id} />
				<button
					type="submit"
					disabled={paying}
					class="w-full rounded-lg py-3 text-base font-medium text-white disabled:opacity-50 {data.method === 'paypay' ? 'bg-[#ff0033] hover:bg-[#d90030]' : 'bg-accent-600 hover:bg-accent-500'}"
				>
					{paying ? m.payment_processing() : data.method === 'paypay' ? `PayPayで ${formatPrice(data.payableTotal)} を支払う` : m.payment_submit({ amount: formatPrice(data.payableTotal) })}
				</button>
			</form>
			<p class="mt-3 text-center text-xs text-stone-400">{m.payment_secure()}</p>
		</div>
	{/if}
</div>
