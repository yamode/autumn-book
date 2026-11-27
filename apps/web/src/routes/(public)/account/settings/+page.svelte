<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { memberLoginCopy } from '$lib/member-login-copy';

	let { data } = $props();
	const links = $derived([
		{ href: '/account/profile', label: m.account_nav_profile() },
		{ href: '/account/cards', label: m.account_nav_cards() },
		...(data.memberLoginMethods ? [{ href: '/account/settings/login', label: memberLoginCopy(getLocale()).title }] : []),
		...(data.bookingMcpEnabled ? [{ href: '/account/ai-connections', label: m.account_nav_ai_connections() }] : [])
	]);
</script>

<svelte:head><title>{m.account_nav_settings()} ｜ 山人</title></svelte:head>

<h2 class="mb-4 text-2xl">{m.account_nav_settings()}</h2>
<ul class="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white px-3">
	{#each links as link (link.href)}
		<li>
			<a href={link.href} class="flex min-h-12 items-center justify-between gap-3 rounded-lg px-2 font-medium text-brand-900 hover:bg-stone-50">
				{link.label}<span aria-hidden="true">›</span>
			</a>
		</li>
	{/each}
</ul>
<form method="POST" action="/auth/logout" class="mt-5">
	<button type="submit" class="min-h-11 rounded-lg border border-stone-300 bg-white px-4 text-sm text-stone-700 hover:bg-stone-50">
		{m.common_logout()}
	</button>
</form>
