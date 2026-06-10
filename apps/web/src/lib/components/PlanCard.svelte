<script lang="ts">
	import { formatPrice } from '$lib/format';
	import CancelPolicyNote from './CancelPolicyNote.svelte';
	import type { RatePlan } from '$lib/types';
	import * as m from '$lib/paraglide/messages';

	let {
		plan,
		href,
		total = null,
		perPerson = null,
		adults = 2,
		remaining = null,
		checkin = ''
	}: {
		plan: Pick<RatePlan, 'name' | 'headline' | 'mealPlan' | 'paymentMethod' | 'highlightTags' | 'photos' | 'basePrice' | 'cancellationPolicy'>;
		href: string;
		total?: number | null;
		perPerson?: number | null;
		adults?: number;
		remaining?: number | null;
		checkin?: string;
	} = $props();
</script>

<a {href} class="group flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition hover:shadow-md sm:flex-row">
	<img src={plan.photos[0]?.url} alt={plan.name} class="h-44 w-full object-cover sm:h-auto sm:w-56" loading="lazy" />
	<div class="flex flex-1 flex-col gap-2 p-4">
		<div class="flex flex-wrap gap-1.5">
			{#each plan.highlightTags as tag}
				<span class="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">{tag}</span>
			{/each}
			<span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{plan.mealPlan}</span>
			<span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
				{plan.paymentMethod === 'card' ? m.plan_card_payment_card() : m.plan_card_payment_local()}
			</span>
		</div>
		<h3 class="font-display text-lg leading-snug text-brand-900 group-hover:underline">{plan.name}</h3>
		<p class="text-sm text-stone-600">{plan.headline}</p>
		<div class="mt-auto flex items-end justify-between gap-2 pt-2">
			<div>
				{#if total !== null && perPerson !== null}
					<p class="text-xl font-bold text-brand-900">
						{formatPrice(total)}
						<span class="text-xs font-normal text-stone-500">{m.plan_card_per_room({ adults: String(adults), perPerson: formatPrice(perPerson) })}</span>
					</p>
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
