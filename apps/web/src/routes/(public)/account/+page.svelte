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
		{#if Number(page.url.searchParams.get('bonus') ?? '0') > 0}{m.account_welcome({ points: Number(page.url.searchParams.get('bonus')).toLocaleString() })}{:else}{m.account_welcome_nobonus()}{/if}
	</p>
{/if}

{#if data.expiring > 0}
	<p class="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
		{m.account_expiring_points({ points: data.expiring.toLocaleString() })} <a href="/search" class="underline">{m.account_expiring_search()}</a>
	</p>
{/if}

{#if data.memberPages.length > 0}
	<!-- あなた専用のページ（本人・家族が対象の特別会員の専用ページ・docs/vip-member-page.md §5.5 D2）。押すとログインのまま専用ページへ -->
	<section class="mb-8">
		<h2 class="mb-1 text-lg text-brand-900">{m.account_member_pages_heading()}</h2>
		<p class="mb-3 text-sm text-stone-500">{m.account_member_pages_note()}</p>
		<div class="grid gap-3 sm:grid-cols-2">
			{#each data.memberPages as p (p.href)}
				<a href={p.href} class="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 transition hover:shadow-md">
					<div class="min-w-0 flex-1">
						<p class="break-words font-semibold text-brand-900">{p.name}</p>
						{#if p.facilityNames.length}<p class="mt-0.5 text-xs text-stone-600">{p.facilityNames.join('・')}</p>{/if}
						{#if p.via === 'family'}<p class="mt-1 text-xs text-amber-800">{m.account_member_pages_family()}</p>{/if}
					</div>
					<span class="shrink-0 text-stone-400">→</span>
				</a>
			{/each}
		</div>
	</section>
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
					{#if b.roomCount > 1}<span class="rounded bg-brand-100 px-1.5 text-xs text-brand-700">{m.account_rooms_badge({ n: String(b.roomCount) })}</span>{/if}
					{#if b.channel === 'ota'}<span class="rounded bg-stone-100 px-1.5 text-xs text-stone-500">{m.account_ota_badge()}</span>{/if}
					{#if b.memberPage}<span class="rounded bg-amber-100 px-1.5 text-xs text-amber-800">{m.member_page_badge()}</span>{/if}
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
					{#if b.memberPage}<span class="hidden rounded bg-amber-100 px-1.5 text-xs text-amber-800 sm:inline">{m.member_page_badge()}</span>{/if}
					<span class="text-stone-400">{b.code}</span>
				</a>
			{/each}
		</div>
	</section>
{/if}
