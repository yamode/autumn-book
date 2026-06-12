<script lang="ts">
	import { page } from '$app/state';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import * as m from '$lib/paraglide/messages';

	let { data, children } = $props();

	const nav = $derived([
		{ href: '/account', label: m.account_nav_reservations(), icon: '📅' },
		{ href: '/account/points', label: m.account_nav_points(), icon: '◆' },
		{ href: '/account/favorites', label: m.account_nav_favorites(), icon: '♥' },
		{ href: '/account/profile', label: m.account_nav_profile(), icon: '👤' },
		{ href: '/community/settings', label: m.forum_settings_link(), icon: '💬' }
	]);

	function isActive(href: string) {
		return href === '/account' ? page.url.pathname === '/account' : page.url.pathname.startsWith(href);
	}
</script>

<div class="mx-auto max-w-5xl px-4 py-8">
	<div class="mb-6 flex flex-wrap items-center justify-between gap-3">
		<div>
			<h1 class="font-display text-2xl text-brand-900">{m.account_layout_heading()}</h1>
			<p class="mt-1 text-sm text-stone-500">{data.member.name} 様（{data.member.memberCode}）</p>
		</div>
		<div class="flex items-center gap-3">
			<RankBadge rank={data.member.rank} />
			<span class="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">{data.balance.toLocaleString()} {m.common_point_unit()}</span>
		</div>
	</div>

	<nav class="mb-6 flex gap-1 overflow-x-auto border-b border-stone-200 sm:gap-2">
		{#each nav as item}
			<a
				href={item.href}
				class="shrink-0 border-b-2 px-4 py-2 text-sm transition {isActive(item.href)
					? 'border-brand-800 font-medium text-brand-900'
					: 'border-transparent text-stone-500 hover:text-brand-800'}"
			>
				{item.icon} {item.label}
			</a>
		{/each}
	</nav>

	{@render children()}
</div>
