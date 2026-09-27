<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { formatDate } from '$lib/format';
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

	// 施設予約セクション（/[brand]/[facility]/**）を外部施設HPから深い誘導で開いた場合の戻り導線（ADR-0001）
	let facilityBackLink = $derived(page.data.facilityBackLink as { name: string; href: string } | null | undefined);

	// ヘッダーの検索バー（トップは本文ヒーローに大きな検索があるので出さない）
	let showHeaderSearch = $derived(showSearch && page.url.pathname !== '/');
	let searchCheckin = $derived(page.url.searchParams.get('checkin') ?? '');
	let searchNights = $derived(Number(page.url.searchParams.get('nights') ?? 1));
	let searchAdults = $derived(Number(page.url.searchParams.get('adults') ?? 2));

	// モバイル（<md）はスティッキーを1行に抑える: 検索は1行サマリのボタンに畳み、ナビ類はメニューへ。
	// 844px 程度の画面でヘッダーが 200px 超を占めていたため（本文の視認領域を確保）
	let mobileSearchOpen = $state(false);
	let mobileMenuOpen = $state(false);
	let searchSummary = $derived(
		searchCheckin
			? m.header_search_summary({ date: formatDate(searchCheckin), nights: String(searchNights), adults: String(searchAdults) })
			: m.header_search_prompt()
	);

	// 画面遷移したら開いているパネルを閉じる（検索実行・メニューのリンク押下後に残さない）
	afterNavigate(() => {
		mobileSearchOpen = false;
		mobileMenuOpen = false;
	});
</script>

<svelte:head>
	<!-- hreflang alternates（設計書 §3） -->
	<link rel="alternate" hreflang="ja" href={jaHref} />
	<link rel="alternate" hreflang="en" href={enHref} />
	<link rel="alternate" hreflang="zh-TW" href={zhTwHref} />
	<link rel="alternate" hreflang="x-default" href={jaHref} />
</svelte:head>

<div class="flex min-h-screen flex-col">
	<!-- 施設HPへの戻り導線はスティッキーに含めない（スクロールで流れてよい・ヘッダーを低く保つ） -->
	{#if facilityBackLink}
		<div class="border-b border-stone-100 bg-stone-50 px-4 py-1.5 text-xs">
			<a href={facilityBackLink.href} class="mx-auto flex max-w-6xl items-center gap-1 text-stone-500 hover:text-brand-800">
				{m.nav_back_to_facility_site({ name: facilityBackLink.name })}
			</a>
		</div>
	{/if}
	<header class="sticky top-0 z-50 border-b border-stone-200 bg-white/95 backdrop-blur">
		<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 md:gap-x-6 md:py-2.5">
			<a href="/" class="shrink-0" aria-label="YAMADO">
				<img src="/portal/brandtype-black.png" alt="" width="1015" height="179" class="h-5 w-auto md:h-6" />
			</a>
			<!-- デスクトップ: ナビ・ログイン・言語を常時表示（従来どおり） -->
			<nav class="hidden items-center gap-4 text-sm text-stone-600 md:flex">
				<a href="/search" class="hover:text-brand-800">{m.nav_find_accommodation()}</a>
				<a href="/membership" class="hover:text-brand-800">{m.nav_membership()}</a>
				<a href="/community" class="hover:text-brand-800">{m.forum_nav()}</a>
			</nav>
			<div class="ml-auto hidden items-center gap-3 text-sm md:flex">
				{#if data.user?.role === 'member'}
					<a href="/account" class="font-medium text-brand-800 hover:underline">{data.user.name} 様</a>
				{:else}
					<a href="/auth/login" class="text-stone-600 hover:text-brand-800">{m.common_login()}</a>
					<a href="/auth/register" class="rounded-md bg-accent-600 px-3 py-1.5 text-white hover:bg-accent-500">{m.common_register()}</a>
				{/if}
				<LocaleSwitcher />
			</div>

			<!-- モバイル: 検索サマリ（1行）＋メニューボタン。ロゴと同じ1行に収める -->
			<div class="ml-auto flex min-w-0 items-center gap-2 md:hidden">
				{#if showHeaderSearch}
					<button
						type="button"
						class="flex min-w-0 items-center gap-1 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-700"
						aria-expanded={mobileSearchOpen}
						aria-controls="header-search-panel"
						aria-label="{m.header_search_toggle_label()}: {searchSummary}"
						onclick={() => {
							mobileSearchOpen = !mobileSearchOpen;
							if (mobileSearchOpen) mobileMenuOpen = false;
						}}
					>
						<span aria-hidden="true">🔍</span>
						<span class="truncate">{searchSummary}</span>
						<span aria-hidden="true" class="text-stone-400 transition {mobileSearchOpen ? 'rotate-180' : ''}">▾</span>
					</button>
				{:else if data.user?.role !== 'member'}
					<a href="/auth/register" class="rounded-md bg-accent-600 px-3 py-1.5 text-xs text-white hover:bg-accent-500">{m.common_register()}</a>
				{/if}
				<button
					type="button"
					class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-700 hover:bg-stone-100"
					aria-expanded={mobileMenuOpen}
					aria-controls="header-mobile-menu"
					aria-label={m.header_menu()}
					onclick={() => {
						mobileMenuOpen = !mobileMenuOpen;
						if (mobileMenuOpen) mobileSearchOpen = false;
					}}
				>
					{#if mobileMenuOpen}
						<svg aria-hidden="true" viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
					{:else}
						<svg aria-hidden="true" viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
					{/if}
				</button>
			</div>

			{#if showHeaderSearch}
				<!-- 検索バー: デスクトップは常時表示、モバイルはサマリボタンで開閉 -->
				<div id="header-search-panel" class="w-full lg:ml-auto lg:w-auto {mobileSearchOpen ? '' : 'hidden md:block'}">
					<SearchBar checkin={searchCheckin} nights={searchNights} adults={searchAdults} />
				</div>
			{/if}
		</div>

		<!-- モバイルメニュー（ナビ・ログイン/登録・言語） -->
		<div id="header-mobile-menu" class="border-t border-stone-100 bg-white md:hidden {mobileMenuOpen ? '' : 'hidden'}">
			<nav class="mx-auto flex max-w-6xl flex-col px-4 py-2 text-sm text-stone-700">
				<a href="/search" class="py-2.5 hover:text-brand-800">{m.nav_find_accommodation()}</a>
				<a href="/membership" class="py-2.5 hover:text-brand-800">{m.nav_membership()}</a>
				<a href="/community" class="py-2.5 hover:text-brand-800">{m.forum_nav()}</a>
				<div class="mt-1 flex items-center gap-3 border-t border-stone-100 pt-3">
					{#if data.user?.role === 'member'}
						<a href="/account" class="font-medium text-brand-800 hover:underline">{data.user.name} 様</a>
					{:else}
						<a href="/auth/login" class="text-stone-600 hover:text-brand-800">{m.common_login()}</a>
						<a href="/auth/register" class="rounded-md bg-accent-600 px-3 py-1.5 text-white hover:bg-accent-500">{m.common_register()}</a>
					{/if}
					<div class="ml-auto"><LocaleSwitcher /></div>
				</div>
			</nav>
		</div>
	</header>

	<main class="flex-1">
		{@render children()}
	</main>

	<footer class="mt-16 border-t border-stone-200 bg-brand-900 text-stone-300">
		<div class="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
			<div>
				<p class="font-display text-lg tracking-widest text-white">YAMADO</p>
				<p class="mt-2 text-xs leading-relaxed">{m.footer_brand_tagline()}</p>
			</div>
			<div class="text-sm">
				<p class="mb-2 font-medium text-white">{m.footer_facilities()}</p>
				<ul class="space-y-1 text-xs">
					<li><a href="/yamado/nishiwaga/plans" class="hover:underline">{m.footer_facility_nishiwaga()}</a></li>
					<li><a href="/yamado/oga/plans" class="hover:underline">{m.footer_facility_oga()}</a></li>
				</ul>
			</div>
			<div class="text-sm">
				<p class="mb-2 font-medium text-white">{m.footer_guide()}</p>
				<ul class="space-y-1 text-xs">
					<li><a href="/membership" class="hover:underline">{m.nav_membership()}</a></li>
					<li><a href="/legal/tokushoho" class="hover:underline">{m.footer_tokushoho()}</a></li>
					<li><a href="/legal/privacy" class="hover:underline">{m.footer_privacy()}</a></li>
					<li><a href="/legal/yakkan" class="hover:underline">{m.footer_yakkan()}</a></li>
				</ul>
			</div>
		</div>
		<p class="border-t border-white/10 py-3 text-center text-[11px] text-stone-500">
			{m.footer_copyright()}
		</p>
	</footer>
</div>
