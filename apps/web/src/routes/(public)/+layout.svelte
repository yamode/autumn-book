<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate, invalidate, onNavigate } from '$app/navigation';
	import { onMount } from 'svelte';
	import { pendingPage } from '$lib/page-transition';
	import PageLoadingBoundary from '$lib/components/PageLoadingBoundary.svelte';
	import { formatDate } from '$lib/format';
	import SiteSearchBar from '$lib/components/SiteSearchBar.svelte';
	import { isPlansListPath } from '$lib/booking-nav';
	import AccountMenu from '$lib/components/AccountMenu.svelte';
	import LocaleSwitcher from '$lib/components/LocaleSwitcher.svelte';
	import { deLocalizeUrl, localizeHref } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	let { data, children } = $props();

	onMount(() => {
		const refreshNotifications = () => {
			if (data.user?.role === 'member' && document.visibilityState === 'visible') void invalidate('book:forum-notifications');
		};
		const timer = window.setInterval(refreshNotifications, 60_000);
		document.addEventListener('visibilitychange', refreshNotifications);
		return () => {
			window.clearInterval(timer);
			document.removeEventListener('visibilitychange', refreshNotifications);
		};
	});

	// 予約フロー中はスティッキー検索バーを出さない（離脱防止・設計書 §7）
	const pending = $derived(pendingPage('public'));
	const visibleUrl = $derived(pending?.url ?? page.url);
	const visibleParams = $derived(pending?.params ?? page.params);

	// hreflang 用の各ロケールURL（hreflang は絶対URL必須のため origin を付与）
	let jaHref = $derived(page.url.origin + localizeHref(page.url.pathname + page.url.search, { locale: 'ja' }));
	let enHref = $derived(page.url.origin + localizeHref(page.url.pathname + page.url.search, { locale: 'en' }));
	let zhTwHref = $derived(page.url.origin + localizeHref(page.url.pathname + page.url.search, { locale: 'zh-TW' }));


	// ヘッダーの検索バーは「宿を探すページ」だけに出す（2026-11-02 指示「検索バーがヘッダーに常にあるのは不自然」）。
	// 空室検索の結果と、施設のトップ・客室・お知らせ等の施設ページ。トップは本文ヒーローに、プラン一覧はページ内に検索があり、
	// プラン詳細はページ内の「ご宿泊の条件」で日程・人数を選ぶので出さない。会員特典・コミュニティ・マイページ等も出さない
	let routeId = $derived(pending?.route.id ?? page.route.id ?? '');
	let showHeaderSearch = $derived(
		!isPlansListPath(deLocalizeUrl(visibleUrl).pathname) &&
			(routeId.startsWith('/(public)/search') ||
				(routeId.startsWith('/(public)/[brand]/[facility]') && !routeId.startsWith('/(public)/[brand]/[facility]/plans/[plan]')))
	);
	// ---- 施設ブランドの表示（2026-11-09）----
	// 施設HPから来た予約の流れ（施設ページ → 予約入力・確認 → 完了）では、同じ施設のサイトの続きだと分かるようにする:
	// ヘッダー左上を施設ロゴ（HP と同じ素材）にし、YAMADO は小さく薄く添える。「← ◯◯の施設サイトへ戻る」も予約入力・完了まで出す。
	// ロゴの無い施設・施設の分からないページ（検索・会員・マイページ等）は従来どおり YAMADO のヘッダー
	const FACILITY_LOGOS: Record<string, { src: string; w: number; h: number }> = {
		nishiwaga: { src: '/site-assets/facility/yamado-logo.png', w: 640, h: 329 },
		oga: { src: '/site-assets/facility/oga-logo.svg', w: 138, h: 71 }
	};
	type FacilityBrand = { name: string; slug: string; site: string | null };
	let facilityBrand = $derived.by((): FacilityBrand | null => {
		const d = page.data as Record<string, any>;
		const facility = pending?.params?.facility;
		if (pending && (facility !== page.params.facility || (!facility && pending.route.id !== page.route.id))) return null;
		if (routeId.startsWith('/(public)/[brand]/[facility]') && d.shellFacility) {
			const f = d.shellFacility;
			return { name: f.name, slug: f.slug, site: d.facilityBackLink?.href ?? null };
		}
		const inBooking = ['/(public)/booking/hold', '/(public)/booking/complete', '/(public)/booking/pay'].some((r) => routeId.startsWith(r));
		if (inBooking && d.facility?.slug) {
			const f = d.facility;
			return { name: f.name, slug: f.slug, site: f.websiteUrl ?? null };
		}
		return null;
	});
	let facilityLogo = $derived(facilityBrand ? (FACILITY_LOGOS[facilityBrand.slug] ?? null) : null);
	let showFacilityLogo = $derived(Boolean(facilityBrand?.site && facilityLogo));

	let searchCheckin = $derived(visibleUrl.searchParams.get('checkin') ?? '');
	let searchNights = $derived(Number(visibleUrl.searchParams.get('nights') ?? 1));
	let searchAdults = $derived(Number(visibleUrl.searchParams.get('adults') ?? 2));
	let searchRooms = $derived(Number(visibleUrl.searchParams.get('rooms') ?? 1));

	// モバイル（<md）はスティッキーを1行に抑える: 検索は1行サマリのボタンに畳み、ナビ類はメニューへ。
	// 844px 程度の画面でヘッダーが 200px 超を占めていたため（本文の視認領域を確保）
	let mobileSearchOpen = $state(false);
	let mobileMenuOpen = $state(false);
	let searchSummary = $derived(
		searchCheckin
			? m.header_search_summary({ date: formatDate(searchCheckin), nights: String(searchNights), adults: String(searchAdults) })
			: m.header_search_prompt()
	);

	let main = $state<HTMLElement>();
	let contentFade: Animation | undefined;
	$effect(() => {
		if (pending) {
			mobileSearchOpen = false;
			mobileMenuOpen = false;
		}
	});

	onNavigate(({ from, to, type }) => {
		if (!from || !to?.route.id?.startsWith('/(public)') || type === 'form') return;
		if (deLocalizeUrl(from.url).pathname === deLocalizeUrl(to.url).pathname) return;
		contentFade?.cancel();
		return () => {
			if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
			const content = main?.querySelector<HTMLElement>('[data-account-content]') ?? main;
			contentFade = content?.animate?.([{ opacity: 0.85 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
		};
	});

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
	<!--
		公式サイトの文字を全体に一回り大きく（2026-10-06 指示。取引先ページと同じ）。基準 16px → 18px。
		Tailwind v4 の文字・余白は rem なので同じ比率で大きくなる。px で直に指定した 10〜18px の文字も rem に読み替えて一緒に大きくする
		（22px 以上の大きな見出しはそのまま）。head に置くので公式サイトにいる間だけ効く（管理画面・取引先ページ・客室案内は各自の指定）。
	-->
	<style>
		html { font-size: 112.5%; }
		.text-\[10px\] { font-size: 0.6250rem; }
		.text-\[11px\] { font-size: 0.6875rem; }
		.text-\[12px\] { font-size: 0.7500rem; }
		.text-\[13px\] { font-size: 0.8125rem; }
		.text-\[14px\] { font-size: 0.8750rem; }
		.text-\[15px\] { font-size: 0.9375rem; }
		.text-\[16px\] { font-size: 1rem; }
		.text-\[17px\] { font-size: 1.0625rem; }
		.text-\[18px\] { font-size: 1.1250rem; }
	</style>
</svelte:head>

<div class="site-public flex min-h-screen flex-col">
	{#if facilityBrand?.site}
		<!-- 施設HPへの戻り導線はスティッキーに含めない（スクロールで流れてよい・ヘッダーを低く保つ）。予約入力・完了の画面にも出す -->
		<div class="border-b border-stone-100 bg-stone-50 px-4 py-1.5 text-xs">
			<a href={facilityBrand.site} class="mx-auto flex max-w-6xl items-center gap-1 text-stone-500 hover:text-brand-800">
				{m.nav_back_to_facility_site({ name: facilityBrand.name })}
			</a>
		</div>
	{/if}
	<header class="sticky top-0 z-50 border-b border-stone-200 bg-white/95 backdrop-blur">
		<div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 md:gap-x-6 md:py-2.5">
			<div class="flex shrink-0 items-center">
				{#if facilityBrand?.site && facilityLogo}
					<a href={facilityBrand.site} class="flex min-h-11 items-center pr-2" aria-label={m.nav_back_to_facility_site({ name: facilityBrand.name })}>
						<img src={facilityLogo.src} alt="" width={facilityLogo.w} height={facilityLogo.h} class="h-9 w-auto md:h-11" />
					</a>
					<span aria-hidden="true" class="h-5 w-px bg-stone-300"></span>
				{/if}
				<a href={localizeHref('/')} class="flex min-h-11 items-center {showFacilityLogo ? 'px-2' : ''}" aria-label="YAMADO Book">
					<img src="/portal/brandtype-black.png" alt="" width="1015" height="179" class="w-auto {showFacilityLogo ? 'h-2.5' : 'h-5 md:h-6'}" />
				</a>
			</div>
			<!-- デスクトップ: ナビ・ログイン・言語を常時表示（従来どおり） -->
			<nav class="hidden items-center gap-4 text-sm text-stone-600 md:flex">
				<a href="/search" class="hover:text-brand-800">{m.nav_find_accommodation()}</a>

				<a href="/membership" class="hover:text-brand-800">{m.nav_membership()}</a>
				<a href="/community" class="hover:text-brand-800">{m.forum_nav()}</a>
				<a href="/kitakaze" class="hover:text-brand-800">{m.radio_nav()}</a>
			</nav>
			<div class="ml-auto hidden items-center gap-3 text-sm md:flex">
				{#if data.user?.role === 'member'}
					<AccountMenu name={data.user.name} forumUnread={data.forumUnread} />
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
				{#if data.user?.role === 'member'}
					<AccountMenu name={data.user.name} forumUnread={data.forumUnread} compact={showHeaderSearch} />
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
				<div id="header-search-panel" class="w-full {mobileSearchOpen ? '' : 'hidden md:block'}">
					<SiteSearchBar checkin={searchCheckin} nights={searchNights} adults={searchAdults} rooms={searchRooms} facility={visibleParams.facility ?? ''} action={visibleParams.facility ? '/' + visibleParams.brand + '/' + visibleParams.facility + '/plans' : '/search'} />
				</div>
			{/if}
		</div>

		<!-- モバイルメニュー（ナビ・ログイン/登録・言語） -->
		<div id="header-mobile-menu" class="border-t border-stone-100 bg-white md:hidden {mobileMenuOpen ? '' : 'hidden'}">
			<nav class="mx-auto flex max-w-6xl flex-col px-4 py-2 text-sm text-stone-700">
				<a href="/search" class="py-2.5 hover:text-brand-800">{m.nav_find_accommodation()}</a>

				<a href="/membership" class="py-2.5 hover:text-brand-800">{m.nav_membership()}</a>
				<a href="/community" class="py-2.5 hover:text-brand-800">{m.forum_nav()}</a>
				<a href="/kitakaze" class="py-2.5 hover:text-brand-800">{m.radio_nav()}</a>
				<div class="mt-1 flex items-center gap-3 border-t border-stone-100 pt-3">
					{#if data.user?.role !== 'member'}
						<a href="/auth/login" class="text-stone-600 hover:text-brand-800">{m.common_login()}</a>
						<a href="/auth/register" class="rounded-md bg-accent-600 px-3 py-1.5 text-white hover:bg-accent-500">{m.common_register()}</a>
					{/if}
					<div class="ml-auto"><LocaleSwitcher /></div>
				</div>
			</nav>
		</div>
	</header>

	<main bind:this={main} class="flex-1">
		<PageLoadingBoundary shell="public" padding="px-4 pt-7 pb-10 sm:px-6 sm:pt-10">{@render children()}</PageLoadingBoundary>
	</main>

	<footer class="mt-16 border-t border-stone-200 bg-brand-900 text-stone-300">
		<div class="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
			<div>
				<p class="font-display text-lg tracking-widest text-white">YAMADO</p>
				<p class="mt-2 text-xs leading-relaxed">{m.home_hero_headline()}</p>
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
					<li><a href="/booking/lookup" class="hover:underline">{m.footer_lookup()}</a></li>
					<li><a href="/legal/tokushoho" class="hover:underline">{m.footer_tokushoho()}</a></li>
					<li><a href="/legal/privacy" class="hover:underline">{m.footer_privacy()}</a></li>
					<li><a href="/legal/yakkan" class="hover:underline">{m.footer_yakkan()}</a></li>
				</ul>
			</div>
		</div>
		<p class="border-t border-white/10 py-3 text-center text-[11px] text-stone-500">
			{m.footer_copyright()}{#if data.demoData} ｜ {m.footer_demo_notice()}{/if}
		</p>
	</footer>
</div>

<style>
	:global(html:has(.site-public)) {
		scrollbar-gutter: stable;
	}

</style>
