<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';

	let { name, compact = false, forumUnread = 0 }: { name: string; compact?: boolean; forumUnread?: number } = $props();
	let root: HTMLDetailsElement | undefined = $state();

	const links = $derived([
		{ href: '/account#reservations', label: m.account_nav_reservations() },
		{ href: '/account/points', label: m.account_nav_points() },
		{ href: '/account/favorites', label: m.account_nav_favorites() },
		{ href: '/account/community/notifications', label: m.forum_notifications() },
		{ href: '/account/profile', label: m.account_nav_profile() }
	]);

	function close() {
		if (root?.open) root.open = false;
	}

	function outsideClick(event: MouseEvent) {
		if (root?.open && event.target instanceof Node && !root.contains(event.target)) close();
	}

	function dismiss(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !root?.open) return;
		close();
		root.querySelector('summary')?.focus();
	}

	afterNavigate(close);
</script>

<svelte:window onclick={outsideClick} onkeydown={dismiss} />

<details bind:this={root} class="relative shrink-0">
	<summary aria-label={forumUnread ? m.forum_account_unread({ count: String(forumUnread) }) : m.account_layout_heading()} class="flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-lg border border-stone-200 px-2 py-1.5 text-sm font-medium text-brand-900 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-brand-800 [&::-webkit-details-marker]:hidden">
		<svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
			<circle cx="12" cy="8" r="3" /><path d="M5 20v-1a7 7 0 0 1 14 0v1" />
		</svg>
		<span class={compact ? 'hidden whitespace-nowrap sm:inline' : 'whitespace-nowrap'}>{m.account_layout_heading()}</span>
		{#if forumUnread}<span aria-hidden="true" class="min-w-4 rounded-full bg-amber-100 px-1 text-center text-[11px] font-semibold text-amber-900">{forumUnread > 99 ? '99+' : forumUnread}</span>{/if}
		<span class="text-xs text-stone-500" aria-hidden="true">▾</span>
	</summary>
	<div class="absolute right-0 top-full z-50 mt-1 w-48 max-w-[calc(100vw-2rem)] rounded-xl border border-stone-200 bg-white py-1 text-sm text-stone-700 shadow-lg">
		<p class="break-words border-b border-stone-100 px-3 py-2 font-medium text-brand-900">{name}</p>
		<ul>
			{#each links as link (link.href)}
				<li><a href={link.href} onclick={close} class="block px-3 py-2 hover:bg-stone-50 focus-visible:bg-stone-50">{link.label}</a></li>
			{/each}
		</ul>
		<form method="POST" action="/auth/logout" class="border-t border-stone-100">
			<button type="submit" class="block w-full px-3 py-2 text-left text-stone-600 hover:bg-stone-50 focus-visible:bg-stone-50">{m.common_logout()}</button>
		</form>
	</div>
</details>
