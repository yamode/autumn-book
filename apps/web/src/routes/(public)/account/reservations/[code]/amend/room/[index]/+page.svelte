<script lang="ts">
	// 公式マイページ: 2 室以上のご予約の「このお部屋を変更」（部屋タイプ・プラン・人数・公式の複数室 M3・docs/official-multi-room.md §17.3.1・§18.5）。
	// ① 人数（GET ?adults=）→ ② 候補（プラン × 部屋タイプ。押すと ?offer=planId__roomTypeId で見積）→ ③ 見積 → 確定（POST ?/confirm → 予約詳細へ 303）。
	// 日程は変えない（日程は amend/ の全室同時の変更）。規則（締切・回数・ペナルティ・在庫・定員・支払方法）は DB が確かめる。
	import { enhance } from '$app/forms';
	import { formatPrice } from '$lib/format';
	import * as m from '$lib/paraglide/messages';
	import AmendRoomPicker, { type AmendRoomPickerItem } from '$lib/components/booking/AmendRoomPicker.svelte';
	import AmendRoomReview from '$lib/components/booking/AmendRoomReview.svelte';

	let { data, form } = $props();

	const ADULTS = [1, 2, 3, 4, 5, 6];
	const SEP = '__';

	let q = $derived(data.quote);
	let sel = $derived(data.selected);
	let selectedKey = $derived(sel ? `${sel.ratePlanId}${SEP}${sel.roomTypeId}` : null);
	const hrefOf = (offer: string, adults: number) => `${data.hrefs.self}?adults=${adults}&offer=${encodeURIComponent(offer)}`;
	let items = $derived<AmendRoomPickerItem[]>(
		data.candidates.map((c) => {
			const key = `${c.ratePlanId}${SEP}${c.roomTypeId}`;
			return {
				key,
				roomName: c.roomName,
				planName: c.planName,
				total: c.total,
				// 今の部屋タイプは自分の部屋を使い回すので残室を出さない
				remaining: c.roomTypeId === data.room.roomTypeId ? null : c.remaining,
				current: c.current,
				selectable: c.selectable,
				blocked: c.blocked,
				href: hrefOf(key, data.adults)
			};
		})
	);
	// 確定できるか（変化あり・締切前・回数あり・オンライン決済済みでない・ペナルティ外・在庫の目安あり）
	let canConfirm = $derived(!!q && !!sel && q.amendable && !q.isNoop && !q.inPenalty && q.available && !data.quoteError);
	let busy = $state(false);
</script>

<svelte:head><title>{m.amend_room_title({ n: String(data.room.index) })}</title></svelte:head>

<nav class="mb-4 text-xs text-stone-400">
	<a href="/account" class="hover:underline">{m.reservation_breadcrumb_list()}</a> /
	<a href={data.hrefs.back} class="hover:underline">{data.code}</a> /
	{m.amend_room_title({ n: String(data.room.index) })}
</nav>

<h1 class="text-xl font-semibold text-brand-900">{m.amend_room_title({ n: String(data.room.index) })}</h1>
<p class="mt-1 text-sm text-stone-500">{m.amend_room_lead()}</p>
<p class="mt-1 text-xs text-stone-400">{m.amend_remaining({ n: String(data.amendRemaining) })}・{m.amend_deadline_note()}</p>

{#if form?.message}
	<p class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{form.message}</p>
{/if}

<!-- 現在のお部屋 -->
<section class="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
	<h2 class="text-sm font-medium text-brand-900">{m.amend_room_current()}</h2>
	<div class="mt-3 rounded-lg border border-stone-200 px-3 py-2 text-sm">
		<p class="text-xs text-stone-500">{m.hold_room_n({ n: String(data.room.index) })}・{data.room.stayCode}</p>
		<p class="font-medium text-brand-900">{data.room.roomName || m.amend_room_fallback()}</p>
		<p class="text-xs text-stone-600">{data.room.planName || m.amend_plan_fallback()}</p>
		<p class="flex justify-between text-xs text-stone-600"><span>{m.amend_adults_val({ n: String(data.room.adults) })}</span><span class="tabular-nums">{formatPrice(data.room.total)}</span></p>
	</div>
</section>

<!-- ① 人数（GET で候補と見積を出し直す。選んでいる候補は引き継ぐ） -->
<form method="GET" class="mt-6 rounded-2xl border border-stone-200 bg-white p-5" data-sveltekit-noscroll>
	<h2 class="text-sm font-medium text-brand-900">{m.amend_step_condition()}</h2>
	<div class="mt-3 flex flex-wrap items-end gap-4">
		<label class="text-xs text-stone-500">
			{m.amend_field_adults()}
			<select name="adults" class="mt-1 block rounded-md border border-stone-300 px-2 py-1.5 text-sm">
				{#each ADULTS as a (a)}
					<option value={a} selected={a === data.adults}>{m.amend_adults_val({ n: String(a) })}</option>
				{/each}
			</select>
		</label>
		{#if selectedKey}<input type="hidden" name="offer" value={selectedKey} />{/if}
		<button type="submit" class="rounded-lg border border-brand-300 bg-white px-5 py-2 text-sm font-medium text-brand-800 hover:bg-brand-50">{m.amend_recalc()}</button>
	</div>
</form>

<!-- ② お部屋・プラン（押すと見積） -->
<section class="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
	<h2 class="text-sm font-medium text-brand-900">{m.amend_step_offer()}</h2>
	<AmendRoomPicker {items} {selectedKey} />
</section>

<!-- ③ 見積 → 確定 -->
{#if data.quoteError}
	<p class="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{data.quoteError}</p>
{:else if q && sel}
	<AmendRoomReview quote={q} roomIndex={data.room.index}>
		<form
			method="POST"
			action="?/confirm"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					busy = false;
					await update({ reset: false });
				};
			}}
			class="mt-5 flex justify-end"
		>
			<input type="hidden" name="ratePlanId" value={sel.ratePlanId} />
			<input type="hidden" name="roomTypeId" value={sel.roomTypeId} />
			<input type="hidden" name="adults" value={data.adults} />
			<button
				type="submit"
				disabled={!canConfirm || busy}
				class="w-full rounded-lg bg-accent-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-accent-500 disabled:cursor-not-allowed disabled:bg-stone-300 sm:w-auto"
			>
				{m.amend_confirm()}
			</button>
		</form>
	</AmendRoomReview>
{/if}
