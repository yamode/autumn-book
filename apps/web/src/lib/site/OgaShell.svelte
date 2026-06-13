<script lang="ts">
	// 男鹿「山人 -oga-」サイトシェル — 現行 oga.yamado.co.jp を踏襲
	// 実測値: 本文 Shippori Mincho B1 16px ls.05em lh1.75 palt #111 / 英字 Cormorant Garamond / UI Inter
	//         固定白ヘッダー（ロゴsvg 100px + ハンバーガーのみ・トップではスクロール後に出現）
	//         右中央固定の縦書き「宿泊予約」ボタン / 本文カラム幅 560〜600px
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import type { ShellFacility, ShellUser } from './types';

	let { facility, user, children }: { facility: ShellFacility; user: ShellUser; children: any } = $props();

	let base = $derived(`/${facility.brandSlug}/${facility.slug}`);
	let drawerOpen = $state(false);
	let scrolled = $state(false);
	// トップ（施設HP）はヒーロー全画面のためスクロール後にヘッダー出現（原サイト挙動）。下層は常時表示
	let isTop = $derived(page.url.pathname.replace(/\/$/, '') === base || page.url.pathname.replace(/\/$/, '').endsWith(facility.slug));
	let headerVisible = $derived(!isTop || scrolled);
	let showSearch = $derived(/\/(plans|rooms)/.test(page.url.pathname));

	onMount(() => {
		const onScroll = () => (scrolled = window.scrollY > 120);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});

	// 原サイトと同じページ構成（自然/料理/レストラン/客室/温泉/館内案内/アクセス/お知らせ）
	const nav = $derived([
		{ href: `${base}/nature`, label: '自然', en: 'Nature' },
		{ href: `${base}/cuisine`, label: '料理', en: 'Cuisine' },
		{ href: `${base}/restaurant`, label: 'レストラン', en: 'Restaurant' },
		{ href: `${base}/rooms`, label: '客室', en: 'Stay' },
		{ href: `${base}/onsen`, label: '温泉', en: 'Onsen' },
		{ href: `${base}/guide`, label: '館内案内', en: 'Facility' },
		{ href: `${base}/access`, label: 'アクセス', en: 'Access' },
		{ href: `${base}/news`, label: 'お知らせ', en: 'News' }
	]);
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:opsz,wght@14..32,400..700&family=Shippori+Mincho+B1:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="oga-site min-h-screen bg-white">
	<!-- ヘッダー（fixed白・ロゴ+ハンバーガーのみ・原サイトはスクロール出現） -->
	<header
		class="fixed left-0 top-0 z-[60] w-full bg-white px-[20px] py-[18px] transition-transform duration-700 sm:px-[30px] sm:py-[26px]"
		style="transform: translateY({headerVisible ? '0' : '-100%'});"
	>
		<div class="flex items-center justify-between">
			<a href={base} class="block">
				<img src="/site-assets/oga/logo.svg" alt={facility.name} width="100" height="51" />
			</a>
			<button type="button" class="flex h-10 w-10 flex-col items-end justify-center gap-2" onclick={() => (drawerOpen = true)} aria-label="メニュー">
				<span class="h-px w-8 bg-[#111]"></span>
				<span class="h-px w-6 bg-[#111]"></span>
			</button>
		</div>
	</header>

	<!-- 右中央固定の縦書き予約ボタン（原サイト: l-header__reserve） -->
	<a
		href="{base}/plans"
		class="fixed right-[18px] top-1/2 z-[55] -translate-y-1/2 bg-[#111] px-3 py-6 text-[13px] tracking-[0.3em] text-white transition-transform duration-700 [writing-mode:vertical-rl] hover:bg-[#333] sm:right-[30px]"
		style="transform: translateY(-50%) translateX({headerVisible ? '0' : '200%'});"
	>
		宿泊予約
	</a>

	<!-- ドロワー（原サイト: Contents リスト + 矢印） -->
	{#if drawerOpen}
		<div class="fixed inset-0 z-[70] overflow-y-auto bg-white">
			<div class="flex items-center justify-between px-[20px] py-[18px] sm:px-[30px] sm:py-[26px]">
				<img src="/site-assets/oga/logo.svg" alt={facility.name} width="100" height="51" />
				<button type="button" class="text-3xl font-light text-[#111]" onclick={() => (drawerOpen = false)} aria-label="閉じる">×</button>
			</div>
			<div class="mx-auto max-w-[600px] px-8 pb-16 pt-8">
				<h3 class="font-inter text-xs tracking-[0.3em] text-stone-400">CONTENTS</h3>
				<ul class="mt-4 divide-y divide-stone-200">
					{#each nav as item}
						<li>
							<a href={item.href} onclick={() => (drawerOpen = false)} class="group flex items-baseline justify-between py-4">
								<span class="text-[17px]">{item.label}</span>
								<span class="font-cormorant text-sm tracking-widest text-stone-400 transition group-hover:translate-x-1">{item.en} →</span>
							</a>
						</li>
					{/each}
				</ul>
				<h3 class="font-inter mt-10 text-xs tracking-[0.3em] text-stone-400">RESERVATION / MEMBER</h3>
				<div class="mt-4 space-y-3">
					<a href="{base}/plans" onclick={() => (drawerOpen = false)} class="block bg-[#111] py-4 text-center text-white tracking-[0.3em] hover:bg-[#333]">宿泊予約</a>
					<a href={user?.role === 'member' ? '/account' : '/auth/login'} class="block border border-stone-300 py-3 text-center text-[14px] tracking-widest hover:bg-stone-50">
						{user?.role === 'member' ? `マイページ（${user.name} 様）` : '会員ログイン'}
					</a>
					<a href="/search" class="block py-2 text-center text-[12px] tracking-widest text-stone-400 hover:underline">全施設から空室検索</a>
				</div>

				<!-- 山人グループ（施設間移動・ブランドポータル） -->
				<h3 class="font-inter mt-10 text-xs tracking-[0.3em] text-stone-400">{facility.brandName} GROUP</h3>
				<ul class="mt-4 divide-y divide-stone-200">
					{#each facility.siblings as sib}
						<li>
							<a href="/{sib.brandSlug}/{sib.slug}" onclick={() => (drawerOpen = false)} class="flex items-baseline justify-between py-4">
								<span class="text-[17px]">{sib.name}</span>
								<span class="font-cormorant text-sm tracking-widest text-stone-400">Visit →</span>
							</a>
						</li>
					{/each}
					<li>
						<a href="/" onclick={() => (drawerOpen = false)} class="flex items-baseline justify-between py-4">
							<span class="text-[17px]">{facility.brandName}ポータル</span>
							<span class="font-cormorant text-sm tracking-widest text-stone-400">Portal →</span>
						</a>
					</li>
				</ul>
			</div>
		</div>
	{/if}

	<!-- 本体（トップはヒーロー全画面=pt不要、下層はヘッダー分の余白） -->
	<main class={isTop ? '' : 'pt-[88px] sm:pt-[104px]'}>
		{#if showSearch}
			<div class="border-b border-stone-200 bg-[#fafafa]">
				<div class="mx-auto max-w-[980px] px-4 py-3">
					<SearchBar
						action="{base}/plans"
						checkin={page.url.searchParams.get('checkin') ?? ''}
						nights={Number(page.url.searchParams.get('nights') ?? 1)}
						adults={Number(page.url.searchParams.get('adults') ?? 2)}
					/>
				</div>
			</div>
		{/if}
		{@render children()}
	</main>

	<!-- フッター（ミニマル・Inter英字） -->
	<footer class="mt-24 bg-[#111] text-white">
		<div class="mx-auto max-w-[980px] px-6 py-14 text-center">
			<img src="/site-assets/oga/logo.svg" alt={facility.name} width="110" height="56" class="mx-auto brightness-0 invert" />
			<p class="mt-5 text-[13px] leading-relaxed tracking-wider text-white/70">{facility.addressPublic}<br />TEL {facility.phone}</p>
			<nav class="font-inter mt-8 flex flex-wrap justify-center gap-x-8 gap-y-2">
				{#each nav as item}
					<a href={item.href} class="text-[11px] tracking-[0.25em] text-white/80 hover:text-white">{item.en.toUpperCase()}</a>
				{/each}
				<a href={user?.role === 'member' ? '/account' : '/auth/login'} class="text-[11px] tracking-[0.25em] text-white/80 hover:text-white">MEMBER</a>
			</nav>
			<!-- 山人グループ（施設間移動・ブランドポータル） -->
			<nav class="font-inter mt-8 flex flex-wrap justify-center gap-x-7 gap-y-2 border-t border-white/15 pt-7">
				<a href="/" class="text-[11px] tracking-[0.25em] text-white/90 hover:text-white">{facility.brandName.toUpperCase()} PORTAL</a>
				<span class="text-[11px] tracking-[0.25em] text-white/40">{facility.name}</span>
				{#each facility.siblings as sib}
					<a href="/{sib.brandSlug}/{sib.slug}" class="text-[11px] tracking-[0.25em] text-white/90 hover:text-white">{sib.name}</a>
				{/each}
			</nav>
			<nav class="mt-6 flex flex-wrap justify-center gap-x-6">
				<a href="/legal/tokushoho" class="text-[11px] text-white/40 hover:underline">特定商取引法に基づく表記</a>
				<a href="/legal/privacy" class="text-[11px] text-white/40 hover:underline">プライバシーポリシー</a>
				<a href="/legal/yakkan" class="text-[11px] text-white/40 hover:underline">宿泊約款</a>
			</nav>
			<p class="font-cormorant mt-8 text-[12px] tracking-[0.3em] text-white/40">© YAMADO -OGA-</p>
		</div>
	</footer>
</div>

<style>
	/* 原サイト実測 16px をベースに、可読性のため 17px へ引き上げ（ユーザー要望） */
	.oga-site {
		font-family: 'Shippori Mincho B1', serif;
		font-size: 17px;
		letter-spacing: 0.05em;
		line-height: 1.85;
		font-feature-settings: 'palt';
		color: #111;
	}
	/* 配下コンポーネントの小さめユーティリティも底上げ */
	.oga-site :global(.text-sm) {
		font-size: 15px;
	}
	.oga-site :global(.text-xs) {
		font-size: 13.5px;
	}
	.oga-site :global(.font-cormorant) {
		font-family: 'Cormorant Garamond', serif;
	}
	.oga-site :global(.font-inter) {
		font-family: 'Inter', sans-serif;
	}
</style>
