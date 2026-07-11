<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatPrice, formatDate, formatDateLong, todayStr } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();

	const NIGHTS = [1, 2, 3, 4, 5];
	const ADULTS = [1, 2, 3, 4, 5, 6];

	let q = $derived(data.quote);
	let sel = $derived(data.selected);

	// 確定可能: 変更対象・締切前・残回数あり・差分あり・ペナルティ外・見積エラー無し
	let canConfirm = $derived(
		!!q && q.amendable && !q.isNoop && !q.inPenalty && !data.quoteError
	);

	function offerValue(o: { ratePlanId: string; roomTypeId: string }): string {
		return `${o.ratePlanId}__${o.roomTypeId}`;
	}
	function isSelected(o: { ratePlanId: string; roomTypeId: string }): boolean {
		return !!sel && sel.ratePlanId === o.ratePlanId && sel.roomTypeId === o.roomTypeId;
	}
</script>

<svelte:head><title>{m.amend_title()}</title></svelte:head>

<nav class="mb-4 text-xs text-stone-400">
	<a href="/account" class="hover:underline">{m.reservation_breadcrumb_list()}</a> /
	<a href="/account/reservations/{data.code}" class="hover:underline">{data.code}</a> /
	{m.amend_title()}
</nav>

<h1 class="text-xl font-semibold text-brand-900">{m.amend_title()}</h1>
<p class="mt-1 text-sm text-stone-500">{m.amend_lead()}</p>
{#if q}
	<p class="mt-1 text-xs text-stone-400">{m.amend_remaining({ n: String(q.amendRemaining) })}・{m.amend_deadline_note()}</p>
{/if}

{#if form?.message}
	<p class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{form.message}</p>
{/if}

<!-- ① 新しい条件・候補の選択（GET で見積を再計算） -->
<form method="GET" class="mt-6 space-y-6">
	<section class="rounded-2xl border border-stone-200 bg-white p-5">
		<h2 class="text-sm font-medium text-brand-900">{m.amend_step_condition()}</h2>
		<div class="mt-3 flex flex-wrap items-end gap-4">
			<label class="text-xs text-stone-500">
				{m.amend_field_checkin()}
				<input type="date" name="checkin" value={data.checkin} min={todayStr()} class="mt-1 block rounded-md border border-stone-300 px-2 py-1.5 text-sm" />
			</label>
			<label class="text-xs text-stone-500">
				{m.amend_field_nights()}
				<select name="nights" class="mt-1 block rounded-md border border-stone-300 px-2 py-1.5 text-sm">
					{#each NIGHTS as n}
						<option value={n} selected={n === data.nights}>{m.amend_nights_val({ n: String(n) })}</option>
					{/each}
				</select>
			</label>
			<label class="text-xs text-stone-500">
				{m.amend_field_adults()}
				<select name="adults" class="mt-1 block rounded-md border border-stone-300 px-2 py-1.5 text-sm">
					{#each ADULTS as a}
						<option value={a} selected={a === data.adults}>{m.amend_adults_val({ n: String(a) })}</option>
					{/each}
				</select>
			</label>
		</div>
	</section>

	<section class="rounded-2xl border border-stone-200 bg-white p-5">
		<h2 class="text-sm font-medium text-brand-900">{m.amend_step_offer()}</h2>
		{#if data.offers.length === 0}
			<p class="mt-3 text-sm text-stone-400">{m.amend_no_offers()}</p>
		{:else}
			<div class="mt-3 space-y-2">
				{#each data.offers as o (offerValue(o))}
					<label class="flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm {isSelected(o) ? 'border-accent-400 bg-accent-50' : 'border-stone-200'}">
						<div class="flex items-center gap-2 min-w-0">
							<input type="radio" name="offer" value={offerValue(o)} checked={isSelected(o)} class="h-4 w-4 shrink-0" />
							<div class="min-w-0">
								<p class="truncate font-medium text-stone-800">{o.roomName || m.amend_room_fallback()}</p>
								<p class="truncate text-xs text-stone-400">{o.planName || m.amend_plan_fallback()}・{m.amend_remaining_rooms({ n: String(o.remaining) })}</p>
							</div>
						</div>
						<span class="shrink-0 text-right text-stone-700">{formatPrice(o.total)}</span>
					</label>
				{/each}
			</div>
		{/if}
	</section>

	<div class="flex justify-end">
		<button type="submit" class="rounded-lg border border-brand-300 bg-white px-5 py-2 text-sm font-medium text-brand-800 hover:bg-brand-50">{m.amend_recalc()}</button>
	</div>
</form>

<!-- ② 差額見積（現在 / 変更後 / 差額） -->
{#if data.quoteError}
	<p class="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{data.quoteError}</p>
{:else if q}
	<section class="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
		<h2 class="text-sm font-medium text-brand-900">{m.amend_step_review()}</h2>

		<div class="mt-4 grid gap-4 sm:grid-cols-3">
			<div class="rounded-xl bg-stone-50 p-4 text-sm">
				<p class="text-xs font-medium text-stone-400">{m.amend_current()}</p>
				<p class="mt-2">{formatDateLong(data.current.checkin)}</p>
				<p class="text-xs text-stone-500">{m.amend_nights_val({ n: String(data.current.nights) })}・{m.amend_adults_val({ n: String(data.current.adults) })}</p>
				{#if data.current.roomName}<p class="mt-1 text-xs text-stone-500">{data.current.roomName}</p>{/if}
				<p class="mt-2 font-medium">{formatPrice(q.oldCharge)}</p>
			</div>
			<div class="rounded-xl bg-accent-50 p-4 text-sm">
				<p class="text-xs font-medium text-accent-700">{m.amend_after()}</p>
				<p class="mt-2">{formatDateLong(data.checkin)}</p>
				<p class="text-xs text-stone-500">{m.amend_nights_val({ n: String(data.nights) })}・{m.amend_adults_val({ n: String(data.adults) })}</p>
				<p class="mt-2 font-medium">{formatPrice(q.newCharge)}</p>
				{#if q.newDiscount > 0}<p class="text-xs text-emerald-700">{m.amend_coupon_applied({ amount: formatPrice(q.newDiscount) })}</p>{/if}
			</div>
			<div class="rounded-xl border border-stone-200 p-4 text-sm">
				<p class="text-xs font-medium text-stone-400">{m.amend_diff()}</p>
				<p class="mt-2 text-lg font-semibold {q.diff > 0 ? 'text-red-600' : q.diff < 0 ? 'text-emerald-700' : 'text-stone-500'}">
					{q.diff > 0 ? '+' : ''}{formatPrice(q.diff)}
				</p>
				{#if q.diff > 0}
					<p class="mt-1 text-xs text-stone-500">{m.amend_pay_onsite()}</p>
				{:else if q.diff < 0}
					<p class="mt-1 text-xs text-stone-500">{m.amend_refund_onsite()}</p>
				{:else}
					<p class="mt-1 text-xs text-stone-500">{m.amend_no_diff()}</p>
				{/if}
				{#if q.pointsRefund > 0}
					<p class="mt-2 text-xs text-emerald-700">{m.amend_refund_points({ points: String(q.pointsRefund) })}</p>
				{/if}
			</div>
		</div>

		{#if q.isNoop}
			<p class="mt-4 rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-500">{m.amend_err_no_change()}</p>
		{:else if q.inPenalty}
			<p class="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{m.amend_penalty_blocked()}</p>
		{/if}

		<!-- ③ 確定 -->
		<form method="POST" action="?/confirm" use:enhance class="mt-5 flex justify-end">
			{#if sel}
				<input type="hidden" name="ratePlanId" value={sel.ratePlanId} />
				<input type="hidden" name="roomTypeId" value={sel.roomTypeId} />
			{/if}
			<input type="hidden" name="checkin" value={data.checkin} />
			<input type="hidden" name="nights" value={data.nights} />
			<input type="hidden" name="adults" value={data.adults} />
			<button
				type="submit"
				disabled={!canConfirm}
				class="rounded-lg bg-accent-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-accent-500 disabled:cursor-not-allowed disabled:bg-stone-300"
			>
				{m.amend_confirm()}
			</button>
		</form>
	</section>
{/if}
