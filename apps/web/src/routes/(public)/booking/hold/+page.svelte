<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Stepper from '$lib/components/Stepper.svelte';
	import HoldTimer from '$lib/components/HoldTimer.svelte';
	import PriceBreakdown from '$lib/components/PriceBreakdown.svelte';
	import CancelPolicyNote from '$lib/components/CancelPolicyNote.svelte';
	import { formatDateLong } from '$lib/format';
	import { invalidateAll } from '$app/navigation';
	import { gaEvent } from '$lib/analytics';
	import * as m from '$lib/paraglide/messages';

	import { formatPrice } from '$lib/format';

	let { data, form } = $props();

	let expiredNow = $state(false);

	// GA4 予約ファネル: 仮押さえ→ゲスト情報入力の開始（設計書 §9）
	$effect(() => {
		if (data.expired) return;
		gaEvent('begin_checkout', { currency: 'JPY' });
	});

	// 支払い方法の選択肢（プランの決済設定から構築。事前決済=即時決済・割引あり）
	let payOptions = $derived.by(() => {
		if (data.expired) return [];
		const opts: { value: 'onsite' | 'card' | 'paypay'; label: string; discount: number }[] = [];
		const rate = Math.round(data.plan.payment.prepayDiscountRate * 100);
		if (data.plan.payment.prepay) {
			for (const mth of data.plan.payment.prepayMethods) {
				opts.push({ value: mth, label: mth === 'card' ? m.pay_card() : m.pay_paypay(), discount: rate });
			}
		}
		if (data.plan.payment.onsite) opts.push({ value: 'onsite', label: m.pay_onsite(), discount: 0 });
		return opts;
	});
	// 既定は割引のある事前決済（先頭）
	let selectedPay = $state<'onsite' | 'card' | 'paypay' | null>(null);
	let payValue = $derived(selectedPay ?? payOptions[0]?.value ?? 'onsite');
	let isPrepay = $derived(payValue !== 'onsite');
	let discountRate = $derived(!data.expired && isPrepay ? data.plan.payment.prepayDiscountRate : 0);
	let discountedTotal = $derived(data.expired ? 0 : Math.round(data.hold.quote.total * (1 - discountRate)));

	let steps = $derived(isPrepay
		? [m.steps_plan(), m.steps_info(), m.steps_payment(), m.steps_complete()]
		: [m.steps_plan(), m.steps_info(), m.steps_complete()]);
</script>

<svelte:head><title>{m.hold_title()}</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8">
	{#if data.expired || expiredNow}
		<div class="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center">
			<p class="text-3xl">⌛</p>
			<h1 class="font-display mt-2 text-xl text-brand-900">{m.hold_expired_heading()}</h1>
			<p class="mt-2 text-sm text-stone-600">{m.hold_expired_msg()}</p>
			<a href="/search" class="mt-4 inline-block rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">{m.hold_expired_search()}</a>
		</div>
	{:else}
		<Stepper {steps} current={1} />

		<div class="mt-6">
			<HoldTimer expiresAt={data.hold.expiresAt} onexpire={() => (expiredNow = true)} />
		</div>

		{#if form?.message}
			<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
		{/if}

		<div class="mt-6 grid gap-6 md:grid-cols-[1fr_320px]">
			<!-- 入力フォーム -->
			<div>
				{#if !data.member}
					<div class="mb-5 rounded-xl border border-accent-500/40 bg-amber-50/60 p-4 text-sm">
						<p class="font-medium text-brand-900">{m.hold_login_prompt()}</p>
						<div class="mt-2 flex gap-2">
							<a href="/auth/login?next={encodeURIComponent(page.url.pathname + page.url.search)}" class="rounded-md bg-brand-800 px-4 py-1.5 text-white hover:bg-brand-700">{m.hold_login_btn()}</a>
							<span class="self-center text-stone-500">{m.hold_guest_continue()}</span>
						</div>
					</div>
				{/if}

				<form method="POST" action="?/submit" use:enhance class="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
					<input type="hidden" name="holdId" value={data.hold.id} />
					<h2 class="font-display text-lg text-brand-900">{m.hold_form_heading()}</h2>

					<!-- 氏名（グローバル正規化: 姓 / 名 / ミドルネーム + カナ） -->
					<div class="grid grid-cols-2 gap-3">
						<label class="block text-sm">
							<span class="text-stone-600">{m.name_family()} <span class="text-red-500">*</span></span>
							<input name="familyName" value={form?.values?.familyName ?? data.member?.familyName ?? ''} placeholder="山田" class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.familyName ? 'border-red-400' : 'border-stone-300'}" />
						</label>
						<label class="block text-sm">
							<span class="text-stone-600">{m.name_given()} <span class="text-red-500">*</span></span>
							<input name="givenName" value={form?.values?.givenName ?? data.member?.givenName ?? ''} placeholder="太郎" class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.givenName ? 'border-red-400' : 'border-stone-300'}" />
						</label>
					</div>
					<label class="block text-sm">
						<span class="text-stone-600">{m.name_middle()} <span class="text-xs text-stone-400">{m.name_optional()}</span></span>
						<input name="middleName" value={form?.values?.middleName ?? data.member?.middleName ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
					</label>
					<div class="grid grid-cols-2 gap-3">
						<label class="block text-sm">
							<span class="text-stone-600">{m.name_family_kana()}</span>
							<input name="familyNameKana" value={form?.values?.familyNameKana ?? data.member?.familyNameKana ?? ''} placeholder="ヤマダ" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
						</label>
						<label class="block text-sm">
							<span class="text-stone-600">{m.name_given_kana()}</span>
							<input name="givenNameKana" value={form?.values?.givenNameKana ?? data.member?.givenNameKana ?? ''} placeholder="タロウ" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
						</label>
					</div>
					{#each [
						{ key: 'phone', label: m.hold_field_phone(), ph: '090-0000-0000', def: data.member?.phone },
						{ key: 'email', label: m.hold_field_email(), ph: 'mail@example.com', def: data.member?.email }
					] as field}
						<label class="block text-sm">
							<span class="text-stone-600">{field.label} <span class="text-red-500">*</span></span>
							<input
								name={field.key}
								value={form?.values?.[field.key as 'phone'] ?? field.def ?? ''}
								placeholder={field.ph}
								class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.[field.key] ? 'border-red-400' : 'border-stone-300'}"
							/>
							{#if form?.errors?.[field.key]}
								<span class="text-xs text-red-600">{form.errors[field.key]}</span>
							{/if}
						</label>
					{/each}

					<div class="grid gap-4 sm:grid-cols-2">
						<label class="block text-sm">
							<span class="text-stone-600">{m.hold_field_arrival()}</span>
							<select name="arrival" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2">
								{#each ['15:00', '16:00', '17:00', '18:00 以降'] as t}
									<option>{t}</option>
								{/each}
							</select>
						</label>
						{#if data.facility.access.shuttle.available}
							<label class="flex items-end gap-2 pb-2 text-sm">
								<input type="checkbox" name="shuttle" class="h-4 w-4" />
								<span>{m.hold_field_shuttle()}<span class="block text-xs text-stone-400">{data.facility.access.shuttle.note}</span></span>
							</label>
						{/if}
					</div>

					<label class="block text-sm">
						<span class="text-stone-600">{m.hold_field_notes()}</span>
						<textarea name="notes" rows="3" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder={m.hold_field_notes_ph()}></textarea>
					</label>

					{#if data.member}
						<div class="rounded-lg bg-emerald-50 p-3 text-sm">
							<p class="font-medium text-emerald-800">{m.hold_points_label({ balance: String(data.member.balance), earn: String(data.member.earn) })}</p>
							<div class="mt-2 flex items-center gap-2">
								<input type="number" name="points" min="0" max={data.member.balance} value={data.hold.quote.pointsUsed} class="w-32 rounded-md border border-stone-300 px-3 py-1.5" />
								<span class="text-stone-500">{m.hold_points_use()}</span>
							</div>
						</div>
					{/if}

					<!-- お支払い方法（事前決済=即時決済・割引適用） -->
					<fieldset class="rounded-lg border border-stone-200 p-3 text-sm">
						<legend class="px-1 font-medium text-brand-900">{m.pay_choose()}</legend>
						<div class="space-y-2">
							{#each payOptions as opt}
								<label class="flex items-center gap-2 rounded-md border px-3 py-2.5 transition {payValue === opt.value ? 'border-accent-500 bg-amber-50/60' : 'border-stone-200'}">
									<input type="radio" name="payment" value={opt.value} checked={payValue === opt.value} onchange={() => (selectedPay = opt.value)} class="h-4 w-4" />
									{#if opt.value === 'paypay'}
										<span class="rounded bg-[#ff0033] px-1.5 py-0.5 text-[11px] font-bold text-white">PayPay</span>
									{/if}
									<span class="flex-1">{opt.label}</span>
									{#if opt.discount > 0}
										<span class="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">{opt.discount}%OFF</span>
									{/if}
								</label>
							{/each}
						</div>
						{#if isPrepay}
							<p class="mt-2 text-xs text-stone-500">{m.pay_prepay_note()}</p>
							{#if discountRate > 0}
								<p class="mt-1 rounded bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
									{m.pay_discount_line({ rate: String(Math.round(discountRate * 100)) })}: <s class="text-stone-400">{formatPrice(data.hold.quote.total)}</s> → <strong>{formatPrice(discountedTotal)}</strong>
								</p>
							{/if}
						{/if}
					</fieldset>

					<button type="submit" class="w-full rounded-lg bg-accent-600 py-3 text-base font-medium text-white hover:bg-accent-500">
						{isPrepay ? m.hold_submit_card() : m.hold_submit_local()}
					</button>
					{#if !isPrepay}
						<p class="text-center text-xs text-stone-400">{m.hold_local_payment_note()}</p>
					{/if}
				</form>
			</div>

			<!-- 予約内容サマリ -->
			<aside class="h-fit rounded-2xl border border-stone-200 bg-white p-5">
				<h2 class="mb-3 font-medium text-brand-900">{m.hold_summary_heading()}</h2>
				<img src={data.room.photos[0]?.url} alt="" class="mb-3 h-32 w-full rounded-lg object-cover" />
				<dl class="space-y-1.5 text-sm">
					<div class="flex justify-between"><dt class="text-stone-500">{m.hold_summary_facility()}</dt><dd>{data.facility.name}</dd></div>
					<div class="flex justify-between"><dt class="text-stone-500">{m.hold_summary_room()}</dt><dd class="text-right">{data.room.name}</dd></div>
					<div class="flex justify-between"><dt class="text-stone-500">{m.hold_summary_plan()}</dt><dd class="max-w-[60%] text-right">{data.plan.name}</dd></div>
					<div class="flex justify-between"><dt class="text-stone-500">{m.hold_summary_checkin()}</dt><dd>{formatDateLong(data.hold.checkin)}</dd></div>
					<div class="flex justify-between"><dt class="text-stone-500">{m.hold_summary_nights_adults()}</dt><dd>{m.hold_nights_adults_val({ nights: String(data.hold.nights), adults: String(data.hold.adults) })}</dd></div>
				</dl>
				<div class="mt-4 border-t border-stone-200 pt-3">
					<PriceBreakdown quote={data.hold.quote} />
				</div>
				<p class="mt-3 rounded bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
					<CancelPolicyNote policy={data.plan.cancellationPolicy} checkin={data.hold.checkin} />
				</p>
			</aside>
		</div>
	{/if}
</div>
