<script lang="ts">
	import { page } from '$app/state';
	import { formatPrice, formatDateLong } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	import type { PageData } from './$types';
	let { data, reservationsOnly = false }: { data: PageData; reservationsOnly?: boolean } = $props();

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

	// 以前の予約システムのこれからの予約（予約一覧ではすべて・ダッシュボードでは Book の予約が無いときだけ 1 件）
	const legacyUpcomingShown = $derived(
		reservationsOnly ? data.legacyStays.upcoming : data.upcoming.length === 0 ? data.legacyStays.upcoming.slice(0, 1) : []
	);
</script>

<svelte:head><title>{reservationsOnly ? m.account_nav_reservations() : m.account_dashboard()} ｜ {m.account_title()}</title></svelte:head>

<section id="reservations" class="mb-5 scroll-mt-24">
	<div class="mb-2 flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-lg text-brand-900">{m.account_upcoming()}</h2>
		{#if !reservationsOnly}<a href="/account/reservations" class="text-sm text-brand-800 underline underline-offset-4">{m.account_all_reservations()}</a>{/if}
	</div>
	{#each (reservationsOnly ? data.upcoming : data.upcoming.slice(0, 1)) as b, index (b.code)}
		<a href="/account/reservations/{b.code}" class="mb-3 flex items-start gap-3 rounded-2xl border border-stone-200 p-3 transition hover:shadow-md sm:gap-4 sm:p-4 {index === 0 ? 'bg-brand-50' : 'bg-white'}">
			{#if b.photo}<img src={b.photo} alt="" class="hidden h-24 w-32 shrink-0 rounded-xl object-cover sm:block" />{/if}
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span class="rounded-full px-2 py-0.5 text-xs {statusCls[b.status]}">{statusLabel[b.status]}</span>
					<span class="text-xs text-stone-400">{b.code}</span>
					{#if b.roomCount > 1}<span class="rounded bg-brand-100 px-1.5 text-xs text-brand-700">{m.account_rooms_badge({ n: String(b.roomCount) })}</span>{/if}
					{#if b.channel === 'ota'}<span class="rounded bg-stone-100 px-1.5 text-xs text-stone-500">{m.account_ota_badge()}</span>{/if}
					{#if b.memberPage}<span class="rounded bg-amber-100 px-1.5 text-xs text-amber-800">{m.member_page_badge()}</span>{/if}
				</div>
				<h3 class="mt-1 text-lg font-semibold text-brand-900">{b.facilityName}</h3>
				<p class="text-[15px] font-medium text-brand-900">{formatDateLong(b.checkin)} · {m.searchbar_nights_option({ n: String(b.nights) })}</p>
				{#if b.roomName}<p class="text-sm text-stone-600">{b.roomName}</p>{/if}
				<p class="mt-1 text-sm font-medium">{formatPrice(b.total - b.pointsUsed)} <span class="text-xs font-normal text-stone-400">{b.payment !== 'onsite' ? m.account_payment_paid() : m.account_payment_local()}</span></p>
				<span class="mt-2 inline-block text-sm font-semibold text-brand-800">{m.account_view_booking()} <span aria-hidden="true">›</span></span>
			</div>
		</a>
	{/each}
	<!-- 以前の予約システム（tripla・予約番）のこれからの予約。見るだけ（変更・取消は以前の予約システムかお電話）。
	     ダッシュボードでは Book の予約が無いときだけ 1 件出す -->
	{#each legacyUpcomingShown as s (s.code)}
		<div class="mb-3 rounded-2xl border border-stone-200 bg-white p-3 sm:p-4">
			<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
				<span class="rounded-full px-2 py-0.5 text-xs {statusCls.reserved}">{statusLabel.reserved}</span>
				<span class="text-xs text-stone-400">{s.code}</span>
				{#if s.roomCount > 1}<span class="rounded bg-brand-100 px-1.5 text-xs text-brand-700">{m.account_rooms_badge({ n: String(s.roomCount) })}</span>{/if}
				<span class="rounded bg-stone-100 px-1.5 text-xs text-stone-600">{m.account_legacy_stays_badge()}</span>
			</div>
			<h3 class="mt-1 text-lg font-semibold text-brand-900">{s.facilityName}</h3>
			<p class="text-[15px] font-medium text-brand-900">{formatDateLong(s.checkin)} · {m.searchbar_nights_option({ n: String(s.nights) })}</p>
			<p class="text-sm text-stone-600">
				{[s.roomTypeName, m.common_adults_unit({ n: String(s.adults) }), s.children > 0 ? m.account_legacy_stays_children({ n: String(s.children) }) : '']
					.filter(Boolean)
					.join(' · ')}
			</p>
			<p class="mt-2 text-xs text-stone-500">{@html data.legacyActive ? m.account_legacy_stays_change_link() : m.account_legacy_stays_change_phone()}</p>
		</div>
	{/each}
	{#if data.upcoming.length === 0 && legacyUpcomingShown.length === 0}
		<div class="rounded-2xl border border-dashed border-stone-300 p-4 text-sm text-stone-600">
			<p>{m.account_no_reservations()}</p>
			<a href="/search" class="mt-1 inline-flex min-h-11 items-center font-medium text-brand-800 underline">{m.account_find_accommodation()}</a>
		</div>
	{/if}
</section>

{#if !reservationsOnly && page.url.searchParams.get('welcome')}
	<p class="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
		{#if Number(page.url.searchParams.get('bonus') ?? '0') > 0}{m.account_welcome({ points: Number(page.url.searchParams.get('bonus')).toLocaleString() })}{:else}{m.account_welcome_nobonus()}{/if}
	</p>
{/if}

{#if !reservationsOnly && page.url.searchParams.get('migrated')}
	<!-- 会員移行の直後: 以前のご利用の反映（紐づけ済み／宿で確認中） -->
	<p class="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
		{page.url.searchParams.get('migrated') === 'linked' ? m.migrate_claim_linked() : page.url.searchParams.get('migrated') === 'pending_review' ? m.migrate_claim_pending() : m.migrate_done_new()}
	</p>
{/if}

{#if !reservationsOnly && 'legacyClaimable' in data && data.legacyClaimable}
	<p class="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
		{m.migrate_claim_banner()} <a href="/account/legacy" class="font-medium underline">{m.migrate_claim_title()}</a>
	</p>
{/if}

{#if data.legacyActive}
	<p class="mb-4 rounded-lg bg-stone-100 px-4 py-3 text-sm text-stone-700">{@html m.account_legacy_note()}</p>
{/if}

{#if reservationsOnly && data.past.length > 0}
	<section class="mt-8">
		<h2 class="mb-4 text-lg text-brand-900">{m.account_past()}</h2>
		<div class="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
			{#each data.past as b (b.code)}
				<a href="/account/reservations/{b.code}" class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-stone-50">
					<span class="font-medium text-brand-900">{b.facilityName}</span>
					<span class="justify-self-end rounded-full px-2 py-0.5 text-xs {statusCls[b.status]}">{statusLabel[b.status]}</span>
					<span class="min-w-0 text-xs text-stone-600">
						{formatDateLong(b.checkin)}
						{#if b.memberPage}<span class="ml-1 rounded bg-amber-100 px-1.5 text-amber-800">{m.member_page_badge()}</span>{/if}
					</span>
					<span class="text-right text-xs text-stone-600">{b.code}</span>
				</a>
			{/each}
		</div>
	</section>
{/if}

{#if reservationsOnly && data.legacyStays.past.length > 0}
	<!-- 以前の予約システムでのご利用（PMS の滞在から・見るだけ。金額・プラン名は無い） -->
	<section class="mt-8">
		<h2 class="mb-1 text-lg text-brand-900">{m.account_legacy_stays_past()}</h2>
		<p class="mb-4 text-sm text-stone-500">{m.account_legacy_stays_past_note()}</p>
		<div class="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
			{#each data.legacyStays.past as s (s.code)}
				<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
					<span class="font-medium text-brand-900">{s.facilityName}</span>
					{#if s.status === 'stayed'}<span class="justify-self-end rounded-full px-2 py-0.5 text-xs {statusCls.stayed}">{statusLabel.stayed}</span>{:else}<span></span>{/if}
					<span class="min-w-0 text-xs text-stone-600">
						{formatDateLong(s.checkin)} · {m.searchbar_nights_option({ n: String(s.nights) })}{#if s.roomCount > 1} · {m.account_rooms_badge({ n: String(s.roomCount) })}{/if}{#if s.roomTypeName} · {s.roomTypeName}{/if}
					</span>
					<span class="text-right text-xs text-stone-600">{s.code}</span>
				</div>
			{/each}
		</div>
	</section>
{/if}

{#await data.memberPages then memberPages}
	{#if !reservationsOnly && memberPages.length > 0}
		<!-- あなた専用のページ（本人・家族が対象の特別会員の専用ページ・docs/vip-member-page.md §5.5 D2）。押すとログインのまま専用ページへ -->
		<section class="my-6">
			<h2 class="mb-1 text-lg text-brand-900">{m.account_member_pages_heading()}</h2>
			<p class="mb-3 text-sm text-stone-500">{m.account_member_pages_note()}</p>
			<div class="grid gap-3 sm:grid-cols-2">
				{#each memberPages as p (p.href)}
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
{/await}
