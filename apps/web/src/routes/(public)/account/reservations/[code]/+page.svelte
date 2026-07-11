<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatPrice, formatDateLong } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
	let b = $derived(data.booking);
	let showCancelConfirm = $state(false);

	// 支払いステータスラベル
	function paymentStatusLabel(status: string): string {
		switch (status) {
			case 'paid': return m.reservation_payment_paid();
			case 'refunded': return m.reservation_payment_refunded();
			case 'partial_refund': return m.reservation_payment_partial();
			default: return m.reservation_payment_unpaid();
		}
	}
</script>

<svelte:head><title>{m.reservation_title({ code: b.code })}</title></svelte:head>

<nav class="mb-4 text-xs text-stone-400"><a href="/account" class="hover:underline">{m.reservation_breadcrumb_list()}</a> / {b.code}</nav>

{#if form?.cancelled}
	<p class="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{m.reservation_cancelled_ok()}</p>
{/if}
{#if form?.message}
	<p class="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{form.message}</p>
{/if}

<div class="grid gap-6 md:grid-cols-[1fr_300px]">
	<div class="rounded-2xl border border-stone-200 bg-white p-6">
		<div class="flex items-center justify-between">
			<h1 class="text-xl font-semibold text-brand-900">{data.facility.name}</h1>
			<span class="rounded-full px-3 py-1 text-xs {b.status === 'reserved' ? 'bg-emerald-50 text-emerald-700' : b.status === 'cancelled' ? 'bg-stone-100 text-stone-500' : 'bg-blue-50 text-blue-600'}">
				{b.status === 'reserved' ? m.account_status_reserved() : b.status === 'cancelled' ? m.account_status_cancelled() : m.account_status_stayed()}
			</span>
		</div>
		<p class="mt-1 text-xs text-stone-400">{m.reservation_booking_number({ code: b.code })}{b.channel === 'ota' ? m.reservation_ota_note() : ''}</p>

		<dl class="mt-5 space-y-2 text-sm">
			<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">{m.reservation_checkin()}</dt><dd>{formatDateLong(b.checkin)} {data.facility.checkinTime}〜</dd></div>
			<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">{m.reservation_nights_adults()}</dt><dd>{b.nights}泊・大人{b.adults}名</dd></div>
			<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">{m.reservation_room()}</dt><dd>{data.room.name}</dd></div>
			<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">{m.reservation_plan()}</dt><dd class="max-w-[60%] text-right">{data.plan.name}</dd></div>
			<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">{m.reservation_guest()}</dt><dd>{m.reservation_guest_val({ name: b.guest.name })}</dd></div>
			{#if b.guest.shuttle}
				<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">{m.reservation_shuttle()}</dt><dd>{m.reservation_shuttle_val()}</dd></div>
			{/if}
			{#if b.guest.notes}
				<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">{m.reservation_notes()}</dt><dd class="max-w-[60%] text-right">{b.guest.notes}</dd></div>
			{/if}
			<div class="flex justify-between pt-1 font-medium"><dt>{m.reservation_total()}</dt><dd>{formatPrice(b.total)}</dd></div>
			{#if b.pointsUsed > 0}
				<div class="flex justify-between text-emerald-700"><dt>{m.reservation_points_used()}</dt><dd>-{b.pointsUsed.toLocaleString()}{m.common_point_unit()}</dd></div>
			{/if}
			<div class="flex justify-between text-stone-500"><dt>{m.reservation_payment()}</dt><dd>{b.payment !== 'onsite' ? `${m.reservation_payment_card()}（${paymentStatusLabel(b.paymentStatus ?? '')}）` : m.reservation_payment_local()}</dd></div>
			{#if b.cancelFee !== undefined}
				<div class="flex justify-between text-red-600"><dt>{m.reservation_cancel_fee()}</dt><dd>{formatPrice(b.cancelFee)}</dd></div>
			{/if}
		</dl>
	</div>

	<aside class="space-y-4">
		{#if b.status === 'reserved' && data.cancelPreview}
			<div class="rounded-2xl border border-stone-200 bg-white p-5 text-sm">
				<h2 class="font-medium text-brand-900">{m.reservation_cancel_section()}</h2>
				<p class="mt-2 rounded bg-stone-50 px-3 py-2 text-stone-600">
					{m.reservation_cancel_today_fee()}
					<strong class="{data.cancelPreview.fee > 0 ? 'text-red-600' : 'text-emerald-700'}">
						{formatPrice(data.cancelPreview.fee)}（{Math.round(data.cancelPreview.rate * 100)}%）
					</strong>
				</p>
				<p class="mt-2 text-xs text-stone-400">{b.cancellationPolicy.note}</p>

				{#if !showCancelConfirm}
					<button type="button" onclick={() => (showCancelConfirm = true)} class="mt-3 w-full rounded-lg border border-red-300 py-2 text-red-600 hover:bg-red-50">{m.reservation_cancel_btn()}</button>
				{:else}
					<div class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
						<p class="font-medium text-red-700">{m.reservation_cancel_confirm_heading()}</p>
						<ul class="mt-1 list-disc pl-4 text-xs text-red-600">
							<li>{m.reservation_cancel_fee_notice({ fee: formatPrice(data.cancelPreview.fee) })}</li>
							{#if b.payment !== 'onsite'}<li>{m.reservation_cancel_refund_notice()}</li>{/if}
							{#if b.pointsUsed > 0}<li>{m.reservation_cancel_points_notice({ points: String(b.pointsUsed) })}</li>{/if}
							{#if b.pointsEarned > 0}<li>{m.reservation_cancel_earn_notice()}</li>{/if}
						</ul>
						<form method="POST" action="?/cancel" use:enhance class="mt-2 flex gap-2">
							<button type="submit" class="flex-1 rounded-md bg-red-600 py-1.5 text-white hover:bg-red-500">{m.reservation_cancel_confirm_btn()}</button>
							<button type="button" onclick={() => (showCancelConfirm = false)} class="flex-1 rounded-md border border-stone-300 bg-white py-1.5">{m.reservation_back()}</button>
						</form>
					</div>
				{/if}

				<p class="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-500">
					{m.reservation_date_change()}<br />
					<a href="tel:{data.facility.phone}" class="font-medium text-brand-800">{data.facility.phone}</a>（{data.facility.name}）
				</p>
			</div>

			<!-- オプション追加枠（P6 §15.2 接続点） -->
			<div class="rounded-2xl border border-dashed border-stone-300 p-5 text-sm text-stone-500">
				<p class="font-medium text-stone-600">{m.reservation_addon_heading()}</p>
				<p class="mt-1 text-xs">{m.reservation_addon_msg()}</p>
			</div>
		{/if}

		<div class="rounded-2xl bg-stone-100 p-5 text-sm">
			<p class="font-medium text-brand-900">{m.reservation_access()}</p>
			<p class="mt-1 text-xs text-stone-600">{data.facility.addressPublic}</p>
			<a href="https://www.google.com/maps/dir/?api=1&destination={data.facility.lat},{data.facility.lng}" target="_blank" rel="noopener" class="mt-2 inline-block text-xs text-accent-600 underline">{m.reservation_map_link()}</a>
		</div>
	</aside>
</div>
