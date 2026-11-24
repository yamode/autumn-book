<script lang="ts">
	// マイページ「クーポン」: 配られたクーポンの一覧（2026-11-24）。おたよりはポイントの側（/account/points/otayori）
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	let { data } = $props();

	const day = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeZone: 'Asia/Tokyo' });
	const fmtDay = (ymd: string) => day.format(new Date(`${ymd}T00:00:00+09:00`));
	const yen = (n: number) => n.toLocaleString(getLocale());

	const statusLabel = $derived({
		issued: m.coupon_status_issued(),
		used: m.coupon_status_used(),
		expired: m.coupon_status_expired(),
		revoked: m.coupon_status_revoked()
	} as const);
	const statusCls = {
		issued: 'bg-emerald-50 text-emerald-700',
		used: 'bg-stone-100 text-stone-500',
		expired: 'bg-stone-100 text-stone-500',
		revoked: 'bg-stone-100 text-stone-500'
	} as const;
	const usable = $derived(data.coupons.filter((c) => c.status === 'issued'));
	const others = $derived(data.coupons.filter((c) => c.status !== 'issued'));
</script>

<svelte:head><title>{m.account_nav_coupons()} ｜ 山人</title></svelte:head>

<h2 class="mb-2 text-2xl">{m.account_nav_coupons()}</h2>
<p class="mb-5 text-sm text-stone-500">{m.coupon_how_to_use()}</p>

{#if data.unavailable}
	<p class="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-500">{m.coupon_load_failed()}</p>
{:else if data.coupons.length === 0}
	<p class="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-500">{m.coupon_empty()}</p>
{:else}
	{#snippet couponCard(c: (typeof data.coupons)[number])}
		<li class="rounded-2xl border border-stone-200 bg-white p-5 {c.status === 'issued' ? '' : 'opacity-70'}">
			<div class="flex items-start justify-between gap-3">
				<p class="min-w-0 font-medium text-stone-900">{c.name}</p>
				<span class="shrink-0 rounded-full px-2 py-0.5 text-xs {statusCls[c.status]}">{statusLabel[c.status]}</span>
			</div>
			<p class="mt-1 text-2xl font-bold text-brand-900">
				{c.discountType === 'percent' ? m.coupon_discount_percent({ value: String(c.discountValue) }) : m.coupon_discount_fixed({ value: yen(c.discountValue) })}
			</p>
			{#if c.description}<p class="mt-2 text-sm whitespace-pre-wrap text-stone-600">{c.description}</p>{/if}
			<dl class="mt-3 space-y-1 text-sm text-stone-500">
				{#if c.validUntil}<div>{m.coupon_valid_until({ date: fmtDay(c.validUntil) })}</div>{/if}
				{#if c.stayFrom || c.stayUntil}<div>{m.coupon_stay_period({ from: c.stayFrom ? fmtDay(c.stayFrom) : '', to: c.stayUntil ? fmtDay(c.stayUntil) : '' })}</div>{/if}
				{#if c.minTotal > 0}<div>{m.coupon_min_total({ amount: yen(c.minTotal) })}</div>{/if}
			</dl>
		</li>
	{/snippet}
	{#if usable.length}
		<ul class="space-y-3">
			{#each usable as c (c.id)}{@render couponCard(c)}{/each}
		</ul>
	{/if}
	{#if others.length}
		<h3 class="mt-8 mb-3 text-base text-stone-600">{m.coupon_past_title()}</h3>
		<ul class="space-y-3">
			{#each others as c (c.id)}{@render couponCard(c)}{/each}
		</ul>
	{/if}
{/if}
