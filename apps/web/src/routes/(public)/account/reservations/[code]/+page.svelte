<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatPrice, formatDateLong, formatDate, todayStr } from '$lib/format';
	import * as m from '$lib/paraglide/messages';
	import type { BookingOptionOrder, BookingAmendment, AmendmentKind } from '$lib/types';

	let { data, form } = $props();
	let b = $derived(data.booking);
	let showCancelConfirm = $state(false);

	// 変更履歴・変更可否
	let amendments = $derived((data.amendments ?? []) as BookingAmendment[]);
	let amend = $derived(data.amend);

	// 変更種別バッジの文言
	function amendKindLabel(kind: AmendmentKind): string {
		switch (kind) {
			case 'dates': return m.amend_kind_dates();
			case 'party': return m.amend_kind_party();
			case 'room': return m.amend_kind_room();
			case 'plan': return m.amend_kind_plan();
			default: return m.amend_kind_composite();
		}
	}

	// 支払いステータスラベル
	function paymentStatusLabel(status: string): string {
		switch (status) {
			case 'paid': return m.reservation_payment_paid();
			case 'refunded': return m.reservation_payment_refunded();
			case 'partial_refund': return m.reservation_payment_partial();
			default: return m.reservation_payment_unpaid();
		}
	}

	// オプションのカテゴリラベル
	function categoryLabel(cat: BookingOptionOrder['category']): string {
		switch (cat) {
			case 'meal': return m.options_category_meal();
			case 'spa': return m.options_category_spa();
			case 'activity': return m.options_category_activity();
			case 'amenity': return m.options_category_amenity();
			case 'personalize': return m.options_category_personalize();
			default: return m.options_category_other();
		}
	}

	// 提供日（無ければチェックイン日）の前日まで取消可（表示判定・強制は RPC/store 側）
	function canCancelOption(o: BookingOptionOrder): boolean {
		if (o.status !== 'reserved') return false;
		const basis = o.serviceDate ?? b.checkin;
		return todayStr() < basis;
	}

	let options = $derived((data.options ?? []) as BookingOptionOrder[]);
	let optionsTotal = $derived(options.reduce((s, o) => s + o.amount, 0));
	// 宿泊日変更でオプションの提供日が滞在期間外になった明細があるか（取り直し導線用）
	let hasNeedsReschedule = $derived(options.some((o) => o.status === 'needs_reschedule'));
</script>

<svelte:head><title>{m.reservation_title({ code: b.code })}</title></svelte:head>

<nav class="mb-4 text-xs text-stone-400"><a href="/account" class="hover:underline">{m.reservation_breadcrumb_list()}</a> / {b.code}</nav>

{#if form?.cancelled}
	<p class="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{m.reservation_cancelled_ok()}</p>
{/if}
{#if form?.optionCancelled}
	<p class="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{m.options_cancel_ok()}</p>
{/if}
{#if form?.message}
	<p class="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{form.message}</p>
{/if}
{#if hasNeedsReschedule}
	<div class="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
		{m.amend_needs_reschedule()}
		<a href="/account/reservations/{b.code}/options" class="ml-1 font-medium underline">{m.amend_needs_reschedule_link()}</a>
	</div>
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

				<!-- あなたの会員グレードの規定（グレード別キャンセル料規定・P3） -->
				<div class="mt-2 rounded border border-stone-100 bg-white px-3 py-2 text-xs">
					<p class="font-medium text-brand-900">{m.cancelrank_your_grade()}</p>
					{#if (data.cancelPreview.rules ?? []).length === 0}
						<p class="mt-1 text-emerald-700">{m.cancelrank_none()}</p>
					{:else}
						<ul class="mt-1 space-y-0.5 text-stone-600">
							{#each data.cancelPreview.rules as rule}
								<li>{m.cancelrank_rule_line({ days: String(rule.days_before), rate: String(Math.round(rule.rate * 100)) })}</li>
							{/each}
						</ul>
						{#if data.cancelPreview.rulesSource === 'plan'}
							<p class="mt-1 text-stone-400">{m.cancelrank_plan_note()}</p>
						{/if}
					{/if}
				</div>

				{#if b.cancellationPolicy.note}<p class="mt-2 text-xs text-stone-400">{b.cancellationPolicy.note}</p>{/if}

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

				<div class="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-500">
					{#if amend?.canAmend}
						<p class="mb-2">{m.amend_intro({ n: String(amend.remaining) })}</p>
						<a href="/account/reservations/{b.code}/amend" class="block w-full rounded-lg border border-brand-300 py-2 text-center font-medium text-brand-800 hover:bg-brand-50">{m.amend_button()}</a>
					{:else}
						<p>
							{m.amend_call_us()}<br />
							<a href="tel:{data.facility.phone}" class="font-medium text-brand-800">{data.facility.phone}</a>（{data.facility.name}）
						</p>
					{/if}
				</div>
			</div>

			<!-- 滞在アレンジ（オプション事前予約・現地精算） -->
			<div class="rounded-2xl border border-stone-200 bg-white p-5 text-sm">
				<div class="flex items-center justify-between">
					<h2 class="font-medium text-brand-900">{m.options_heading()}</h2>
					<a href="/account/reservations/{b.code}/options" class="text-xs font-medium text-accent-600 hover:underline">{m.options_add()}</a>
				</div>

				{#if options.length === 0}
					<p class="mt-2 text-xs text-stone-400">{m.options_none()}</p>
				{:else}
					<ul class="mt-3 space-y-2">
						{#each options as o (o.orderId)}
							<li class="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2">
								<div class="flex items-start justify-between gap-2">
									<div class="min-w-0">
										<p class="truncate font-medium text-stone-700">{o.name}</p>
										<p class="mt-0.5 text-xs text-stone-400">
											{categoryLabel(o.category)}
											{#if o.serviceDate}・{formatDate(o.serviceDate)}{/if}
											{#if o.quantity > 1}・{m.options_qty({ n: String(o.quantity) })}{/if}
										</p>
										{#if o.note}<p class="mt-0.5 text-xs text-stone-400">{o.note}</p>{/if}
										{#if o.status === 'needs_reschedule'}
											<p class="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">{m.options_needs_reschedule()}</p>
										{/if}
									</div>
									<span class="shrink-0 text-xs font-medium {o.amount === 0 ? 'text-emerald-700' : 'text-stone-700'}">
										{o.amount === 0 ? m.options_free() : formatPrice(o.amount)}
									</span>
								</div>
								{#if canCancelOption(o)}
									<form method="POST" action="?/cancelOption" use:enhance class="mt-1.5 text-right">
										<input type="hidden" name="orderId" value={o.orderId} />
										<button type="submit" class="text-xs text-red-500 hover:underline">{m.options_cancel()}</button>
									</form>
								{:else if o.status === 'reserved'}
									<p class="mt-1 text-right text-xs text-stone-400">{m.options_cancel_phone()}</p>
								{/if}
							</li>
						{/each}
					</ul>
					<div class="mt-3 flex justify-between border-t border-stone-100 pt-2 text-xs">
						<span class="text-stone-500">{m.options_local_payment()}</span>
						<span class="font-medium text-stone-700">{optionsTotal === 0 ? m.options_free() : formatPrice(optionsTotal)}</span>
					</div>
				{/if}
			</div>
		{/if}

		<div class="rounded-2xl bg-stone-100 p-5 text-sm">
			<p class="font-medium text-brand-900">{m.reservation_access()}</p>
			<p class="mt-1 text-xs text-stone-600">{data.facility.addressPublic}</p>
			<a href="https://www.google.com/maps/dir/?api=1&destination={data.facility.lat},{data.facility.lng}" target="_blank" rel="noopener" class="mt-2 inline-block text-xs text-accent-600 underline">{m.reservation_map_link()}</a>
		</div>
	</aside>
</div>

{#if amendments.length > 0}
	<section class="mt-6 rounded-2xl border border-stone-200 bg-white p-6">
		<h2 class="text-sm font-medium text-brand-900">{m.amend_history_heading()}</h2>
		<ul class="mt-3 space-y-2 text-sm">
			{#each [...amendments].reverse() as a (a.amendmentNo)}
				<li class="flex items-center justify-between gap-3 border-b border-stone-100 pb-2 last:border-0">
					<div class="flex items-center gap-2">
						<span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{amendKindLabel(a.kind)}</span>
						<span class="text-xs text-stone-400">{formatDate((a.createdAt ?? '').slice(0, 10))}</span>
					</div>
					<div class="text-right">
						<span class="text-xs {a.diffAmount > 0 ? 'text-red-600' : a.diffAmount < 0 ? 'text-emerald-700' : 'text-stone-500'}">
							{a.diffAmount > 0 ? '+' : ''}{formatPrice(a.diffAmount)}
						</span>
						{#if a.pointsRefund > 0}
							<span class="ml-2 text-xs text-emerald-700">{m.amend_refund_points({ points: String(a.pointsRefund) })}</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}
