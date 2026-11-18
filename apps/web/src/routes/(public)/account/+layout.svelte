<script lang="ts">
	import { page } from '$app/state';
	import { pendingPage } from '$lib/page-transition';
	import PageLoadingBoundary from '$lib/components/PageLoadingBoundary.svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import { rankName } from '$lib/rank-name';
	import { deLocalizeUrl } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	let { data, children } = $props();

	const primaryNav = $derived([
		{ href: '/account/reservations', label: m.account_nav_reservations() },
		{ href: '/account/points', label: m.account_nav_points() },
		{ href: '/account/community', label: m.account_nav_community() }
	]);
	const utilityNav = $derived([
		{ href: '/account/settings', label: m.account_nav_settings() }
	]);
	const bookingNav = $derived([
		{ href: '/account/coupons', label: m.account_nav_coupons() },
		{ href: '/account/favorites', label: m.account_nav_favorites() },
		{ href: '/account/availability-alerts', label: m.account_nav_availability_alerts() },
		{ href: '/account/upgrades', label: m.account_nav_upgrades() }
	]);
	const pathname = $derived(deLocalizeUrl(pendingPage('account')?.url ?? page.url).pathname);
	const settingsDetail = $derived(['/account/profile', '/account/cards', '/account/ai-connections'].includes(pathname));
	const settingsActive = $derived(pathname === '/account/settings' || settingsDetail);
	const bookingSection = $derived(isActive('/account/reservations') || bookingNav.some((item) => isActive(item.href)));

	function isActive(href: string) {
		if (href === '/account') return pathname === href;
		if (href === '/account/settings') return settingsActive;
		return pathname === href || pathname.startsWith(href + '/');
	}

	// 氏名のイニシャル（アバター代替）
	const initial = $derived((data.member.name ?? '').trim().charAt(0) || '·');
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
		<div class="flex w-full flex-wrap items-center gap-x-2 sm:w-auto">
			<a href="/account/points#member-rank" class="inline-flex min-h-11 items-center rounded-md"
				aria-label={`${rankName(data.member.rank)} · ${m.points_rank_progress()}`}>
				<RankBadge rank={data.member.rank} />
			</a>
			<a href="/account/points" class="inline-flex min-h-11 items-center rounded-md">
				<span class="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800">{data.balance.toLocaleString()} {m.common_point_unit()}</span>
			</a>
		</div>
	</header>

	<div class="grid items-start gap-3 sm:gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
		<nav aria-label={m.account_layout_heading()} class="flex flex-col rounded-xl border border-stone-200 bg-white p-2">
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
					<a href="/account/settings" class="mb-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-brand-800 underline underline-offset-4"><span aria-hidden="true">←</span>{m.account_back_settings()}</a>
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
</div>
