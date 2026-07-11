<script lang="ts">
	import { page } from '$app/state';
	import { formatPrice, formatDateLong } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();

	// ステータスラベルはメッセージから取得
	const statusLabel = $derived({
		reserved: m.account_status_reserved(),
		cancelled: m.account_status_cancelled(),
		stayed: m.account_status_stayed()
	} as const);

	const statusCls = {
		reserved: 'bg-emerald-50 text-emerald-700',
		cancelled: 'bg-stone-100 text-stone-500',
		stayed: 'bg-blue-50 text-blue-600'
	} as const;
</script>

<svelte:head><title>{m.account_title()}</title></svelte:head>

{#if page.url.searchParams.get('welcome')}
	<p class="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
		{m.account_welcome()}
	</p>
{/if}

{#if data.expiring > 0}
	<p class="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
		{m.account_expiring_points({ points: data.expiring.toLocaleString() })} <a href="/search" class="underline">{m.account_expiring_search()}</a>
	</p>
{/if}

<section>
	<h2 class="mb-4 text-lg text-brand-900">{m.account_upcoming()}</h2>
	{#each data.upcoming as b}
		<a href="/account/reservations/{b.code}" class="mb-3 flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-4 transition hover:shadow-md sm:flex-row">
			<img src={b.photo} alt="" class="h-32 w-full rounded-xl object-cover sm:w-48" />
			<div class="flex-1">
				<div class="flex items-center gap-2">
					<span class="rounded-full px-2 py-0.5 text-xs {statusCls[b.status]}">{statusLabel[b.status]}</span>
					<span class="text-xs text-stone-400">{b.code}</span>
					{#if b.channel === 'ota'}<span class="rounded bg-stone-100 px-1.5 text-xs text-stone-500">{m.account_ota_badge()}</span>{/if}
				</div>
				<h3 class="mt-1 text-lg font-semibold text-brand-900">{b.facilityName}</h3>
				<p class="text-[15px] text-stone-600">{formatDateLong(b.checkin)} から {b.nights}泊 ・ {b.roomName} ・ 大人{b.adults}名</p>
				<p class="mt-1 text-sm font-medium">{formatPrice(b.total - b.pointsUsed)} <span class="text-xs font-normal text-stone-400">{b.payment !== 'onsite' ? m.account_payment_paid() : m.account_payment_local()}</span></p>
			</div>
			<span class="self-center text-stone-300">→</span>
		</a>
	{:else}
		<div class="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
			{m.account_no_reservations()}<a href="/search" class="text-accent-600 underline">{m.account_find_accommodation()}</a>
		</div>
	{/each}
</section>

{#if data.past.length > 0}
	<section class="mt-8">
		<h2 class="mb-4 text-lg text-brand-900">{m.account_past()}</h2>
		<div class="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
			{#each data.past as b}
				<a href="/account/reservations/{b.code}" class="flex items-center gap-3 px-4 py-3 text-sm hover:bg-stone-50">
					<span class="rounded-full px-2 py-0.5 text-xs {statusCls[b.status]}">{statusLabel[b.status]}</span>
					<span class="flex-1">{b.facilityName} ／ {formatDateLong(b.checkin)}〜</span>
					<span class="text-stone-400">{b.code}</span>
				</a>
			{/each}
		</div>
	</section>
{/if}
