<script lang="ts">
	// マイページ「クーポン」: 配られたクーポンの一覧（2026-11-24）。使えるものはコードとコピーのボタン。
	// おたよりの記録はポイントの側（/account/points/otayori）
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import type { MyCoupon } from '$lib/my-coupons';
	let { data } = $props();

	const day = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeZone: 'Asia/Tokyo' });
	const fmtDay = (ymd: string) => day.format(new Date(`${ymd}T00:00:00+09:00`));
	const yen = (n: number) => n.toLocaleString(getLocale());

	const statusLabel = $derived({
		usable: m.coupon_status_issued(),
		upcoming: m.coupon_status_upcoming(),
		used: m.coupon_status_used(),
		expired: m.coupon_status_expired(),
		revoked: m.coupon_status_revoked(),
		unavailable: m.coupon_status_unavailable()
	} as const);
	const statusCls: Record<MyCoupon['state'], string> = {
		usable: 'bg-emerald-50 text-emerald-700',
		upcoming: 'bg-sky-50 text-sky-700',
		used: 'bg-stone-100 text-stone-500',
		expired: 'bg-stone-100 text-stone-500',
		revoked: 'bg-stone-100 text-stone-500',
		unavailable: 'bg-stone-100 text-stone-500'
	};
	const current = $derived(data.coupons.filter((c) => c.state === 'usable' || c.state === 'upcoming'));
	const past = $derived(data.coupons.filter((c) => c.state !== 'usable' && c.state !== 'upcoming'));

	let copied = $state<string | null>(null);
	async function copy(c: MyCoupon) {
		if (!c.code) return;
		try {
			await navigator.clipboard.writeText(c.code);
			copied = c.id;
			setTimeout(() => (copied = copied === c.id ? null : copied), 2000);
		} catch {
			/* クリップボードが使えない環境ではコードを選んでコピーしてもらう */
		}
	}
</script>

<svelte:head><title>{m.account_nav_coupons()} ｜ 山人</title></svelte:head>

<h2 class="mb-2 text-2xl">{m.account_nav_coupons()}</h2>
<p class="mb-5 text-sm text-stone-500">{m.coupon_how_to_use()}</p>

{#snippet couponCard(c: MyCoupon)}
	<li class="rounded-2xl border border-stone-200 bg-white p-5 {c.state === 'usable' || c.state === 'upcoming' ? '' : 'opacity-70'}">
		<div class="flex items-start justify-between gap-3">
			<p class="min-w-0 font-medium text-stone-900">{c.name}</p>
			<span class="shrink-0 rounded-full px-2 py-0.5 text-xs {statusCls[c.state]}">{statusLabel[c.state]}</span>
		</div>
		<p class="mt-1 text-2xl font-bold text-brand-900">
			{c.discountType === 'percent' ? m.coupon_discount_percent({ value: String(c.discountValue) }) : m.coupon_discount_fixed({ value: yen(c.discountValue) })}
		</p>
		{#if c.code}
			<div class="mt-3 flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2">
				<span class="text-xs text-stone-500">{m.coupon_code_label()}</span>
				<span class="font-mono text-base font-semibold tracking-wider text-stone-900 select-all">{c.code}</span>
				<button type="button" onclick={() => copy(c)} class="ml-auto min-h-9 rounded-md border border-stone-300 bg-white px-3 text-xs hover:bg-stone-100">
					{copied === c.id ? m.coupon_copied() : m.coupon_copy()}
				</button>
			</div>
		{/if}
		{#if c.description}<p class="mt-2 text-sm whitespace-pre-wrap text-stone-600">{c.description}</p>{/if}
		<dl class="mt-3 space-y-1 text-sm text-stone-500">
			{#if c.state === 'upcoming' && c.validFrom}<div>{m.coupon_valid_from({ date: fmtDay(c.validFrom) })}</div>{/if}
			{#if c.validUntil}<div>{m.coupon_valid_until({ date: fmtDay(c.validUntil) })}</div>{/if}
			{#if c.facilityName}<div>{m.coupon_facility({ name: c.facilityName })}</div>{/if}
			{#if c.stayFrom || c.stayUntil}<div>{m.coupon_stay_period({ from: c.stayFrom ? fmtDay(c.stayFrom) : '', to: c.stayUntil ? fmtDay(c.stayUntil) : '' })}</div>{/if}
			{#if c.minTotal > 0}<div>{m.coupon_min_total({ amount: yen(c.minTotal) })}</div>{/if}
		</dl>
	</li>
{/snippet}

{#if data.unavailable}
	<p class="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-500">{m.coupon_load_failed()}</p>
{:else if data.coupons.length === 0}
	<p class="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-500">{m.coupon_empty()}</p>
{:else}
	{#if current.length}
		<ul class="space-y-3">
			{#each current as c (c.id)}{@render couponCard(c)}{/each}
		</ul>
	{/if}
	{#if past.length}
		<h3 class="mt-8 mb-3 text-base text-stone-600">{m.coupon_past_title()}</h3>
		<ul class="space-y-3">
			{#each past as c (c.id)}{@render couponCard(c)}{/each}
		</ul>
	{/if}
{/if}
