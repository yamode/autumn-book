<script lang="ts">
	import { page } from '$app/state';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import * as m from '$lib/paraglide/messages';

	let { data, children } = $props();

	// マイページのタブ。おたよりはポイントに統合済み。コミュニティ設定も account 配下に移設。
	const nav = $derived([
		{ href: '/account', label: m.account_nav_reservations() },
		{ href: '/account/points', label: m.account_nav_points() },
		{ href: '/account/favorites', label: m.account_nav_favorites() },
		{ href: '/account/community', label: m.account_nav_community() },
		{ href: '/account/profile', label: m.account_nav_profile() }
	]);

	function isActive(href: string) {
		return href === '/account' ? page.url.pathname === '/account' : page.url.pathname.startsWith(href);
	}

	// 氏名のイニシャル（アバター代替）
	const initial = $derived((data.member.name ?? '').trim().charAt(0) || '·');
</script>

<div class="account-shell mx-auto max-w-5xl px-4 py-8 sm:px-6">
	<!-- ヘッダー: アバター・氏名・ランク・ポイント・ログアウト -->
	<header class="mb-8 flex flex-wrap items-center gap-4">
		{#if data.member.avatarUrl}
			<img src={data.member.avatarUrl} alt="" class="h-14 w-14 shrink-0 rounded-full object-cover" />
		{:else}
			<div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-800 text-2xl font-semibold text-white">
				{initial}
			</div>
		{/if}
		<div class="min-w-0 flex-1">
			<h1 class="text-2xl leading-tight sm:text-3xl">{m.account_layout_heading()}</h1>
			<p class="mt-1 text-sm text-stone-500">{data.member.name} 様</p>
		</div>
		<div class="flex items-center gap-2.5">
			<RankBadge rank={data.member.rank} />
			<span class="rounded-full bg-emerald-50 px-3.5 py-1.5 text-sm font-semibold text-emerald-700">
				{data.balance.toLocaleString()} {m.common_point_unit()}
			</span>
			<form method="POST" action="/auth/logout">
				<button type="submit" class="rounded-lg border border-stone-300 px-3.5 py-1.5 text-sm text-stone-600 hover:bg-stone-50">
					{m.common_logout()}
				</button>
			</form>
		</div>
	</header>

	<!-- タブ: 大きめ・タッチしやすい下線タブ -->
	<nav class="mb-8 -mx-4 flex gap-1 overflow-x-auto border-b border-stone-200 px-4 sm:mx-0 sm:gap-2 sm:px-0">
		{#each nav as item}
			<a
				href={item.href}
				aria-current={isActive(item.href) ? 'page' : undefined}
				class="shrink-0 border-b-2 px-4 py-3 text-[15px] font-medium transition {isActive(item.href)
					? 'border-brand-800 text-brand-900'
					: 'border-transparent text-stone-500 hover:text-brand-800'}"
			>
				{item.label}
			</a>
		{/each}
	</nav>

	{@render children()}
</div>
