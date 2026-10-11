<script lang="ts" module>
	import type { AmendRoomsQuoteRoom } from '$lib/multi-room';

	/** 部屋の変更の見積のうち、画面で使う所（lib/server/supabase-data.ts の AmendRoomsQuote と同じ形の一部） */
	export type AmendRoomReviewQuote = {
		ok: boolean;
		amendable: boolean;
		amendRemaining: number;
		isNoop: boolean;
		pastDeadline: boolean;
		oldCharge: number;
		newCharge: number;
		newDiscount: number;
		diff: number;
		pointsRefund: number;
		inPenalty: boolean;
		available: boolean;
		prepaidOnline: boolean;
		liveRooms: number;
		rooms: AmendRoomsQuoteRoom[];
	};
</script>

<script lang="ts">
	// 「このお部屋を変更」の見積（③ 変更内容の確認）。公式マイページと特別会員の専用ページで共用（docs/official-multi-room.md §18.6）。
	//   この部屋の今 → 変更後・予約全体の今 → 変更後・差額・返還ポイント・変更後の料金の明細（N泊目 → 部屋の行）・
	//   変更後のキャンセル規定（プランが変わるとき）・確定できない理由（変化なし・満室・ペナルティ・締切・回数・オンライン決済済み）。
	// 確定のフォームは呼び出し側（children）。確定できるかは呼び出し側で amendable・isNoop・inPenalty・available から判定する。
	import type { Snippet } from 'svelte';
	import { formatPrice, formatNightDate } from '$lib/format';
	import { nightGroups, policyRulesOf } from '$lib/multi-room';
	import * as m from '$lib/paraglide/messages';

	let { quote: q, roomIndex, children }: { quote: AmendRoomReviewQuote; roomIndex: number; children?: Snippet } = $props();

	let room = $derived(q.rooms.find((r) => r.index === roomIndex) ?? null);
	let multi = $derived(q.liveRooms > 1);
	let groups = $derived(room ? nightGroups([{ lines: room.lines }]) : []);
	let planChanged = $derived(!!room && room.changed && room.planId !== room.oldPlanId);
	let policy = $derived(room ? policyRulesOf(room.cancellationPolicy) : null);
	// 確定できない理由（上から順に 1 つ）
	let blocker = $derived(
		q.isNoop
			? m.amend_err_no_change()
			: q.prepaidOnline
				? m.amend_prepaid_blocked()
				: !q.available
					? m.amend_err_sold_out()
					: q.pastDeadline
						? m.amend_err_past_deadline()
						: q.amendRemaining <= 0
							? m.amend_err_limit()
							: q.inPenalty
								? m.amend_err_penalty()
								: !q.amendable
									? m.amend_failed()
									: null
	);
</script>

<section class="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
	<h2 class="text-sm font-medium text-brand-900">{m.amend_step_review()}</h2>

	<div class="mt-4 grid gap-4 sm:grid-cols-3">
		{#if room}
			<div class="rounded-xl bg-stone-50 p-4 text-sm">
				<p class="text-xs font-medium text-stone-400">{m.amend_room_this_room({ n: String(roomIndex) })}</p>
				<p class="mt-2 flex justify-between gap-2"><span class="text-xs text-stone-500">{m.amend_room_badge_current()}</span><span class="tabular-nums">{formatPrice(room.oldTotal)}</span></p>
				<p class="mt-1 flex justify-between gap-2"><span class="text-xs text-accent-700">{m.amend_after()}</span><span class="font-medium tabular-nums">{formatPrice(room.newTotal)}</span></p>
				{#if room.couponShare > 0}<p class="mt-1 text-right text-xs text-emerald-700">{m.amend_coupon_applied({ amount: formatPrice(room.couponShare) })}</p>{/if}
			</div>
		{/if}
		<div class="rounded-xl bg-accent-50 p-4 text-sm">
			<p class="text-xs font-medium text-accent-700">{m.amend_room_whole()}</p>
			<p class="mt-2 flex justify-between gap-2"><span class="text-xs text-stone-500">{m.amend_room_badge_current()}</span><span class="tabular-nums">{formatPrice(q.oldCharge)}</span></p>
			<p class="mt-1 flex justify-between gap-2"><span class="text-xs text-accent-700">{m.amend_after()}</span><span class="font-medium tabular-nums">{formatPrice(q.newCharge)}</span></p>
			{#if q.newDiscount > 0}<p class="mt-1 text-right text-xs text-emerald-700">{m.amend_coupon_applied({ amount: formatPrice(q.newDiscount) })}</p>{/if}
		</div>
		<div class="rounded-xl border border-stone-200 p-4 text-sm">
			<p class="text-xs font-medium text-stone-400">{m.amend_diff()}</p>
			<p class="mt-2 text-lg font-semibold tabular-nums {q.diff > 0 ? 'text-red-600' : q.diff < 0 ? 'text-emerald-700' : 'text-stone-500'}">
				{q.diff > 0 ? '+' : ''}{formatPrice(q.diff)}
			</p>
			<p class="mt-1 text-xs text-stone-500">{q.diff > 0 ? m.amend_pay_onsite() : q.diff < 0 ? m.amend_refund_onsite() : m.amend_no_diff()}</p>
			{#if q.pointsRefund > 0}<p class="mt-2 text-xs text-emerald-700">{m.amend_refund_points({ points: String(q.pointsRefund) })}</p>{/if}
		</div>
	</div>
	{#if multi}<p class="mt-2 text-xs text-stone-500">{m.amend_room_share_note()}</p>{/if}

	{#if room && groups.length > 0}
		<!-- 変更後の料金の明細（泊ごとの見出し → 部屋の行。複数室は「N室目」を付ける） -->
		<div class="mt-4 rounded-xl border border-stone-100 p-4 text-sm">
			<p class="text-xs font-medium text-stone-500">{m.amend_room_breakdown()}</p>
			<div class="mt-2 space-y-1.5">
				{#each groups as g (g.date)}
					<div>
						<p class="text-xs font-medium text-stone-500">{m.price_night_heading({ n: String(g.night), date: formatNightDate(g.date) })}</p>
						{#each g.rows as r (r.room)}
							<div class="flex justify-between gap-2 pl-3 text-stone-600">
								<span class="min-w-0">
									{multi
										? m.price_night_room_row({ room: String(roomIndex), unit: formatPrice(r.unitPrice), adults: String(r.adults) })
										: m.price_night_row({ unit: formatPrice(r.unitPrice), adults: String(r.adults) })}
								</span>
								<span class="whitespace-nowrap tabular-nums">{formatPrice(r.subtotal)}</span>
							</div>
						{/each}
					</div>
				{/each}
				<div class="flex justify-between border-t border-stone-200 pt-1.5 font-medium">
					<span>{m.price_breakdown_total()}</span>
					<span class="tabular-nums">{formatPrice(room.newTotal)}</span>
				</div>
			</div>
		</div>
	{/if}

	{#if planChanged && policy}
		<!-- 変更後のキャンセル規定（プランが変わる部屋は新しいプランの規定。特別会員は予約時の方式を合成した値） -->
		<div class="mt-4 rounded-xl border border-stone-100 p-4 text-xs">
			<p class="font-medium text-brand-900">{policy.source === 'member_page' ? m.member_page_rules_heading() : m.amend_room_policy_heading()}</p>
			{#if policy.source === 'rank'}
				<p class="mt-1 text-stone-600">{m.amend_room_policy_rank()}</p>
			{:else if policy.rules.length === 0}
				<p class="mt-1 text-emerald-700">{m.cancelrank_none()}</p>
			{:else}
				<ul class="mt-1 space-y-0.5 text-stone-600">
					{#each policy.rules as rule, i (i)}
						<li>{m.cancelrank_rule_line({ days: String(rule.days_before), rate: String(Math.round(rule.rate * 100)) })}</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	{#if blocker}
		<p class="mt-4 rounded-lg {q.isNoop ? 'bg-stone-50 text-stone-500' : 'bg-amber-50 text-amber-800'} px-4 py-3 text-sm">{blocker}</p>
	{/if}

	{@render children?.()}
</section>
