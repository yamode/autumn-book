<script lang="ts">
	import { formatPrice } from '$lib/format';
	import CancelPolicyNote from './CancelPolicyNote.svelte';
	import { guestsLabel } from './guests';
	import type { RatePlan } from '$lib/types';
	import * as m from '$lib/paraglide/messages';

	let {
		plan,
		href,
		total = null,
		perPerson = null,
		adults = 2,
		childCount = 0,
		nights = 1,
		remaining = null,
		checkin = ''
	}: {
		plan: Pick<RatePlan, 'name' | 'headline' | 'mealPlan' | 'payment' | 'highlightTags' | 'photos' | 'basePrice' | 'cancellationPolicy'>;
		href: string;
		total?: number | null;
		perPerson?: number | null;
		adults?: number;
		childCount?: number;
		nights?: number;
		remaining?: number | null;
		checkin?: string;
	} = $props();

	// 料金表示の単位は全画面で「1名1泊・税込」を主、1室の合計を従に統一する。
	// perPerson は「大人1名あたりの全泊合計」（子ども分は含まない）なので、泊数で割って 1名1泊 に揃える。
	// 合計（total）は子ども分を含む1室の総額。
	let perPersonNight = $derived(perPerson !== null ? Math.round(perPerson / Math.max(1, nights)) : null);
</script>

<a {href} class="group flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition hover:shadow-md sm:flex-row">
	<img src={plan.photos[0]?.url} alt={plan.name} class="h-44 w-full object-cover sm:h-auto sm:w-56" loading="lazy" />
	<div class="flex flex-1 flex-col gap-2 p-4">
		<div class="flex flex-wrap gap-1.5">
			{#each plan.highlightTags as tag}
				<span class="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">{tag}</span>
			{/each}
			<span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{plan.mealPlan}</span>
			{#if plan.payment.onsite}
				<span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{m.pay_onsite()}</span>
			{/if}
			{#if plan.payment.prepay && plan.payment.prepayDiscountRate > 0}
				<span class="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
					{m.pay_prepay_off({ rate: String(Math.round(plan.payment.prepayDiscountRate * 100)) })}
				</span>
			{:else if plan.payment.prepay}
				<span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{m.plan_card_payment_card()}</span>
			{/if}
			{#if plan.payment.prepay && plan.payment.prepayMethods.includes('paypay')}
				<span class="rounded-full bg-[#ff0033]/10 px-2 py-0.5 text-xs font-medium text-[#d90030]">PayPay</span>
			{/if}
		</div>
		<h3 class="font-display text-lg leading-snug text-brand-900 group-hover:underline">{plan.name}</h3>
		{#if plan.headline && plan.headline !== plan.name}
			<p class="text-sm text-stone-600">{plan.headline}</p>
		{/if}
		<div class="mt-auto flex items-end justify-between gap-2 pt-2">
			<div>
				{#if total !== null && perPerson !== null && perPersonNight !== null}
					<p class="text-xl font-bold text-brand-900">
						{formatPrice(perPersonNight)}<span class="text-xs font-normal text-stone-500">{childCount > 0 ? m.price_unit_adult_night() : m.price_unit_pp_night()}</span>
					</p>
					<p class="text-xs text-stone-500">{m.plan_card_per_room({ guests: guestsLabel(adults, childCount), nights: String(nights), total: formatPrice(total) })}</p>
				{:else}
					<p class="text-xl font-bold text-brand-900">
						{formatPrice(plan.basePrice)}<span class="text-xs font-normal text-stone-500">{m.plan_card_base_price()}</span>
					</p>
				{/if}
				{#if checkin}
					<p class="mt-0.5 text-xs text-emerald-700"><CancelPolicyNote policy={plan.cancellationPolicy} {checkin} /></p>
				{/if}
			</div>
			{#if remaining !== null && remaining > 0 && remaining <= 2}
				<span class="shrink-0 rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-600">{m.plan_card_remaining({ n: String(remaining) })}</span>
			{/if}
		</div>
	</div>
</a>
