<script lang="ts">
	import { page } from '$app/state';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import LocaleSwitcher from '$lib/components/LocaleSwitcher.svelte';
	import { localizeHref } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	let { data, children } = $props();

	// 予約フロー中はスティッキー検索バーを出さない（離脱防止・設計書 §7）
	let showSearch = $derived(!page.url.pathname.startsWith('/booking') && !page.url.pathname.startsWith('/auth'));

	// hreflang 用の各ロケールURL（hreflang は絶対URL必須のため origin を付与）
	let jaHref = $derived(page.url.origin + localizeHref(page.url.pathname + page.url.search, { locale: 'ja' }));
	let enHref = $derived(page.url.origin + localizeHref(page.url.pathname + page.url.search, { locale: 'en' }));
	let zhTwHref = $derived(page.url.origin + localizeHref(page.url.pathname + page.url.search, { locale: 'zh-TW' }));
</script>

<svelte:head>
	<!-- hreflang alternates（設計書 §3） -->
	<link rel="alternate" hreflang="ja" href={jaHref} />
	<link rel="alternate" hreflang="en" href={enHref} />
	<link rel="alternate" hreflang="zh-TW" href={zhTwHref} />
	<link rel="alternate" hreflang="x-default" href={jaHref} />
</svelte:head>

<div class="flex min-h-screen flex-col">
	<header class="sticky top-0 z-50 border-b border-stone-200 bg-white/95 backdrop-blur">
		<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
			<a href="/" class="font-display text-xl font-bold tracking-widest text-brand-900">山人 <span class="text-xs font-normal tracking-normal text-stone-400">- yamado -</span></a>
			<nav class="flex items-center gap-4 text-sm text-stone-600">
				<a href="/search" class="hover:text-brand-800">{m.nav_find_accommodation()}</a>
				<a href="/yamado/nishiwaga" class="hidden hover:text-brand-800 sm:inline">{m.nav_nishiwaga()}</a>
				<a href="/yamado/oga" class="hidden hover:text-brand-800 sm:inline">{m.nav_oga()}</a>
			</nav>
			<div class="ml-auto flex items-center gap-3 text-sm">
				{#if data.user?.role === 'member'}
					<a href="/account" class="font-medium text-brand-800 hover:underline">{data.user.name} 様</a>
				{:else}
					<a href="/auth/login" class="text-stone-600 hover:text-brand-800">{m.common_login()}</a>
					<a href="/auth/register" class="rounded-md bg-accent-600 px-3 py-1.5 text-white hover:bg-accent-500">{m.common_register()}</a>
				{/if}
				<LocaleSwitcher />
			</div>
			{#if showSearch && page.url.pathname !== '/'}
				<div class="w-full lg:ml-auto lg:w-auto">
					<SearchBar
						checkin={page.url.searchParams.get('checkin') ?? ''}
						nights={Number(page.url.searchParams.get('nights') ?? 1)}
						adults={Number(page.url.searchParams.get('adults') ?? 2)}
					/>
				</div>
			{/if}
		</div>
	</header>

	<main class="flex-1">
		{@render children()}
	</main>

	<footer class="mt-16 border-t border-stone-200 bg-brand-900 text-stone-300">
		<div class="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
			<div>
				<p class="font-display text-lg text-white">山人 -yamado-</p>
				<p class="mt-2 text-xs leading-relaxed">{m.footer_brand_tagline()}</p>
			</div>
			<div class="text-sm">
				<p class="mb-2 font-medium text-white">{m.footer_facilities()}</p>
				<ul class="space-y-1 text-xs">
					<li><a href="/yamado/nishiwaga" class="hover:underline">{m.footer_facility_nishiwaga()}</a></li>
					<li><a href="/yamado/oga" class="hover:underline">{m.footer_facility_oga()}</a></li>
				</ul>
			</div>
			<div class="text-sm">
				<p class="mb-2 font-medium text-white">{m.footer_guide()}</p>
				<ul class="space-y-1 text-xs">
					<li><a href="/legal/tokushoho" class="hover:underline">{m.footer_tokushoho()}</a></li>
					<li><a href="/legal/privacy" class="hover:underline">{m.footer_privacy()}</a></li>
					<li><a href="/legal/yakkan" class="hover:underline">{m.footer_yakkan()}</a></li>
					<li><a href="/admin" class="text-stone-500 hover:underline">{m.footer_admin()}</a></li>
				</ul>
			</div>
		</div>
		<p class="border-t border-white/10 py-3 text-center text-[11px] text-stone-500">
			{m.footer_copyright()}
		</p>
	</footer>
</div>
