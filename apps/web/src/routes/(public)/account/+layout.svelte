<script lang="ts">
	import { page } from '$app/state';
	import { pendingPage } from '$lib/page-transition';
	import PageLoadingBoundary from '$lib/components/PageLoadingBoundary.svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import AdminIcon, { type AdminIconName } from '$lib/components/admin/AdminIcon.svelte';
	import { rankName } from '$lib/rank-name';
	import { memberDisplayRank } from '$lib/member-rank';
	import { deLocalizeUrl } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	let { data, children } = $props();

	const primaryNav = $derived([
		{ href: '/account/reservations', label: m.account_nav_reservations(), icon: 'calendar' },
		{ href: '/account/points', label: m.account_nav_points(), icon: 'wallet' },
		{ href: '/account/community', label: m.account_nav_community(), icon: 'users' }
	] satisfies { href: string; label: string; icon: AdminIconName }[]);
	const mobileNav = $derived([
		{ href: '/account', label: m.account_nav_home(), icon: 'home' as const },
		...primaryNav
	]);
	const utilityNav = $derived([
		{ href: '/account/settings', label: m.account_nav_settings() },
		// 会員サポート（docs/member-support.md）。スマホではアカウント設定の一覧から開く
		{ href: '/help', label: m.help_nav_label() }
	]);
	const bookingNav = $derived([
		// クーポン（配られたクーポンの一覧）。おたよりの記録はポイントの配下（/account/points/otayori・2026-11-24）
		{ href: '/account/coupons', label: m.account_nav_coupons() },
		{ href: '/account/favorites', label: m.account_nav_favorites() },
		{ href: '/account/availability-alerts', label: m.account_nav_availability_alerts() },
		{ href: '/account/upgrades', label: m.account_nav_upgrades() }
	]);
	const pathname = $derived(deLocalizeUrl(pendingPage('account')?.url ?? page.url).pathname);
	const settingsDetail = $derived(['/account/profile', '/account/cards', '/account/ai-connections', '/account/settings/login'].includes(pathname));
	const settingsActive = $derived(pathname === '/account/settings' || settingsDetail);
	const bookingSection = $derived(isActive('/account/reservations') || bookingNav.some((item) => isActive(item.href)));

	function isActive(href: string) {
		if (href === '/account') return pathname === href;
		if (href === '/account/settings') return settingsActive;
		return pathname === href || pathname.startsWith(href + '/');
	}

	// 氏名のイニシャル（アバター代替）
	const initial = $derived((data.member.name ?? '').trim().charAt(0) || '·');
	const rank = $derived(memberDisplayRank(data.member.rank));
</script>

<div class="account-shell mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
	<header class="mb-3 flex flex-wrap items-center gap-x-2.5 rounded-2xl border border-stone-200 bg-white px-3 py-2 sm:mb-5 sm:gap-x-4 sm:px-5 sm:py-3">
		{#if data.member.avatarUrl}
			<img src={data.member.avatarUrl} alt="" class="h-9 w-9 shrink-0 rounded-full object-cover sm:h-12 sm:w-12" />
		{:else}
			<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-800 text-lg font-semibold text-white sm:h-12 sm:w-12">
				{initial}
			</div>
		{/if}
		<div class="min-w-0 flex-1">
			<h1 class="text-xl leading-tight sm:text-2xl">{m.account_layout_heading()}</h1>
			<p class="mt-1 break-words text-sm text-stone-600">{m.account_member_greeting({ name: data.member.name })}</p>
		</div>
		<a href="/account/settings" aria-label={m.account_nav_settings()}
			aria-current={settingsActive ? 'location' : undefined}
			class="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-brand-800 focus-visible:outline-2 focus-visible:outline-brand-800 lg:hidden {settingsActive ? 'bg-brand-50' : 'hover:bg-stone-50'}">
			<AdminIcon name="settings" class="size-[1.05rem]" />
			{m.account_nav_settings_short()}
		</a>
		<div class="flex w-full flex-wrap items-center gap-x-2 sm:w-auto">
			<a href="/account/points#member-rank" class="inline-flex min-h-11 items-center rounded-md"
				aria-label={`${rankName(rank)} · ${m.points_rank_progress()}`}>
				<RankBadge {rank} />
			</a>
			<a href="/account/points" class="inline-flex min-h-11 items-center rounded-md">
				<span class="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800">{data.balance.toLocaleString()} {m.common_point_unit()}</span>
			</a>
		</div>
	</header>

	<div class="grid items-start gap-3 sm:gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
		<nav aria-label={m.account_layout_heading()} class="hidden flex-col rounded-xl border border-stone-200 bg-white p-2 lg:flex">
			<a href="/account" aria-current={isActive('/account') ? 'page' : undefined}
				class="mb-1 flex min-h-11 items-center justify-center rounded-lg px-2.5 text-sm font-medium lg:justify-start {isActive('/account') ? 'bg-brand-800 text-white' : 'text-stone-700 hover:bg-stone-100'}">{m.account_dashboard()}</a>
			<ul class="grid grid-cols-[1fr_1fr_1.55fr] gap-1 lg:grid-cols-1">
				{#each primaryNav as item (item.href)}
					<li class="min-w-0">
						<a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}
							class="relative flex min-h-11 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-center text-sm font-medium leading-snug focus-visible:outline-2 focus-visible:outline-brand-800 lg:justify-start lg:px-2.5 {isActive(item.href) ? 'bg-brand-800 text-white' : item.href === '/account/reservations' && bookingSection ? 'bg-stone-100 text-brand-900' : 'text-stone-700 hover:bg-stone-100'}">
							<span class="min-w-0 wrap-break-word">{item.label}</span>
							{#if item.href === '/account/community' && data.forumUnread > 0}
								<span class="absolute right-0 top-0 rounded-full bg-amber-100 px-1 text-[10px] font-semibold leading-tight text-amber-900 lg:static lg:ml-auto lg:px-1.5 lg:text-xs">
									<span class="sr-only">{m.forum_unread()} </span>{data.forumUnread > 99 ? '99+' : data.forumUnread}
								</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
			<ul class="mt-1 border-t border-stone-100 pt-1 lg:mt-2 lg:pt-2">
				{#each utilityNav as item (item.href)}
					<li><a href={item.href} aria-current={isActive(item.href) ? 'location' : undefined}
						class="flex min-h-11 items-center justify-center rounded-lg px-2.5 text-center text-sm font-medium lg:justify-start lg:text-left {isActive(item.href) ? 'bg-brand-800 text-white' : 'text-stone-700 hover:bg-stone-100'}">{item.label}</a></li>
				{/each}
			</ul>
			<ul class="mt-2 hidden space-y-1 border-t border-stone-200 pt-2 lg:block">
				{#each bookingNav as item (item.href)}
					<li><a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}
						class="flex min-h-11 items-center rounded-lg px-2.5 text-sm font-medium {isActive(item.href) ? 'bg-brand-800 text-white' : 'text-stone-700 hover:bg-stone-100'}">{item.label}</a></li>
				{/each}
			</ul>
		</nav>
		<div class="min-w-0 space-y-5">
			<div data-account-content>
				{#if settingsDetail}
					<a href="/account/settings"
						class="mb-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-stone-100 pl-3 pr-4 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 hover:text-brand-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-800">
						<AdminIcon name="chevron" class="size-4 shrink-0 rotate-180" />
						{m.account_back_settings()}
					</a>
				{/if}
				<PageLoadingBoundary shell="account" padding="py-2">{@render children()}</PageLoadingBoundary>
			</div>
			{#if bookingSection || isActive('/account')}
				<nav aria-label={m.account_booking_links()} class="rounded-xl border border-stone-200 bg-white p-3 lg:hidden">
					<h2 class="px-2 text-sm font-semibold">{m.account_booking_links()}</h2>
					<ul class="divide-y divide-stone-100">
						{#each bookingNav as item (item.href)}
							<li><a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}
								class="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 text-sm {isActive(item.href) ? 'font-semibold text-brand-900' : 'text-stone-700 hover:bg-stone-50'}">{item.label}<span aria-hidden="true">›</span></a></li>
						{/each}
					</ul>
				</nav>
			{/if}
		</div>
	</div>

	<nav aria-label={m.account_layout_heading()} class="account-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white shadow-[0_-4px_18px_rgba(28,25,23,0.05)] lg:hidden">
		<ul class="mx-auto grid max-w-xl grid-cols-[1fr_1fr_1fr_minmax(4.625rem,1fr)] gap-1">
			{#each mobileNav as item (item.href)}
				{@const active = isActive(item.href) || (item.href === '/account/reservations' && bookingSection)}
				<li class="min-w-0">
					<a href={item.href} aria-current={active ? (pathname === item.href ? 'page' : 'location') : undefined}
						class="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 text-center text-[11px] leading-tight focus-visible:outline-2 focus-visible:outline-brand-800 {active ? 'font-bold text-brand-900' : 'font-medium text-stone-600 hover:bg-stone-50'}">
						<span class="relative flex h-7 w-12 items-center justify-center rounded-full {active ? 'bg-brand-100' : ''}">
							<AdminIcon name={item.icon} class="size-[1.125rem]" />
							{#if item.href === '/account/community' && data.forumUnread > 0}
								<span class="absolute -top-1 -right-1 min-w-4 rounded-full bg-amber-100 px-1 text-center text-[10px] font-semibold leading-4 text-amber-900">
									<span class="sr-only">{m.forum_unread()} </span>{data.forumUnread > 99 ? '99+' : data.forumUnread}
								</span>
							{/if}
						</span>
						<span class="max-w-full wrap-break-word">{item.label}</span>
					</a>
				</li>
			{/each}
		</ul>
	</nav>
</div>

<style>
	.account-bottom-nav {
		padding: .3rem max(.5rem, env(safe-area-inset-right)) calc(.35rem + env(safe-area-inset-bottom)) max(.5rem, env(safe-area-inset-left));
	}

	@media (width < 64rem) {
		:global(html:has(.account-bottom-nav)) {
			--account-bottom-inset: calc(4.5rem + env(safe-area-inset-bottom));
			scroll-padding-bottom: var(--account-bottom-inset);
		}
		:global(.site-public:has(.account-bottom-nav)) > :global(footer) {
			padding-bottom: var(--account-bottom-inset);
		}
	}
</style>
