<script lang="ts">
	import { page } from '$app/state';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import { rankName } from '$lib/rank-name';
	import { deLocalizeUrl } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	let { data, children } = $props();

	const nav = $derived([
		{ href: '/account', label: m.account_nav_reservations() },
		{ href: '/account/points', label: m.account_nav_points() },
		{ href: '/account/favorites', label: m.account_nav_favorites() },
		{ href: '/account/availability-alerts', label: m.account_nav_availability_alerts() },
		{ href: '/account/upgrades', label: m.account_nav_upgrades() },
		{ href: '/account/community', label: m.account_nav_community() },
		// 保存カード（2026-10-07・docs/saved-cards.md §6.2）
		{ href: '/account/cards', label: m.account_nav_cards() },
		{ href: '/account/profile', label: m.account_nav_profile() },
		...(data.bookingMcpEnabled ? [{ href: '/account/ai-connections', label: m.account_nav_ai_connections() }] : [])
	]);
	const pathname = $derived(deLocalizeUrl(page.url).pathname);

	function isActive(href: string) {
		if (href === '/account') return pathname === href || pathname.startsWith('/account/reservations/');
		return pathname === href || pathname.startsWith(href + '/');
	}

	// 氏名のイニシャル（アバター代替）
	const initial = $derived((data.member.name ?? '').trim().charAt(0) || '·');
</script>

<div class="account-shell mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
	<!-- ヘッダー: アバター・氏名・ランク・ポイント・ログアウト -->
	<header class="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-stone-200 bg-white p-4 sm:mb-6 sm:gap-x-4 sm:p-5">
		{#if data.member.avatarUrl}
			<img src={data.member.avatarUrl} alt="" class="h-11 w-11 shrink-0 rounded-full object-cover sm:h-14 sm:w-14" />
		{:else}
			<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-800 text-xl font-semibold text-white sm:h-14 sm:w-14">
				{initial}
			</div>
		{/if}
		<div class="min-w-0 flex-1">
			<h1 class="text-2xl leading-tight sm:text-3xl">{m.account_layout_heading()}</h1>
			<p class="mt-1 break-words text-sm text-stone-600">{m.account_member_greeting({ name: data.member.name })}</p>
		</div>
		<div class="flex w-full flex-wrap items-center gap-x-2 gap-y-1 sm:w-auto">
			<a href="/account/points#member-rank" class="inline-flex min-h-11 items-center rounded-md"
				aria-label={`${rankName(data.member.rank)} · ${m.points_rank_progress()}`}>
				<RankBadge rank={data.member.rank} />
			</a>
			<a href="/account/points" class="inline-flex min-h-11 items-center rounded-md">
				<span class="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800">{data.balance.toLocaleString()} {m.common_point_unit()}</span>
			</a>
			<form method="POST" action="/auth/logout" class="ml-auto sm:ml-1">
				<button type="submit" class="min-h-11 rounded-lg px-2 text-sm text-stone-600 hover:bg-stone-50">
					{m.common_logout()}
				</button>
			</form>
		</div>
	</header>

	<div class="grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
		<nav aria-label={m.account_layout_heading()} class="rounded-xl border border-stone-200 bg-white p-2">
			<ul class="grid grid-cols-2 gap-1 min-[390px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-1">
				{#each nav as item (item.href)}
					<li class="min-w-0">
						<a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}
							class="flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium leading-snug focus-visible:outline-2 focus-visible:outline-brand-800 {isActive(item.href) ? 'bg-brand-800 text-white' : 'text-stone-700 hover:bg-stone-100'}">
							<span class="min-w-0 wrap-break-word">{item.label}</span>
							{#if item.href === '/account/community' && data.forumUnread > 0}
								<span class="ml-auto shrink-0 rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">
									<span class="sr-only">{m.forum_unread()} </span>{data.forumUnread > 99 ? '99+' : data.forumUnread}
								</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
		<div class="min-w-0">{@render children()}</div>
	</div>
</div>
