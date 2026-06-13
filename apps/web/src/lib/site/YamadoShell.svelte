<script lang="ts">
	// 西和賀「山人 -yamado-」サイトシェル — 現行 www.yamado.co.jp のヘッダー/フッター/タイポグラフィを踏襲
	// 実測値: 固定ヘッダー bg rgba(255,255,255,.8)・ロゴ130px・ナビ16px(#000, hover #b2b2b2)
	//         ご予約ボタン bg#e5e5e5 padding 0 60px hover#4d4d4d / 本文 游明朝16px lh1.6 #333 / コンテナ980px
	import { page } from '$app/state';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { ShellFacility, ShellUser } from './types';

	let { facility, user, children }: { facility: ShellFacility; user: ShellUser; children: any } = $props();

	let base = $derived(`/${facility.brandSlug}/${facility.slug}`);
	let menuOpen = $state(false);
	// 施設トップはヒーロー全画面のためヘッダーを画像に重ねる（pt 不要）。下層はヘッダー分を空ける
	let isTop = $derived(page.url.pathname.replace(/\/$/, '') === base);
	// プラン・客室ページでは検索条件バー（共通機能への入口）を出す
	let showSearch = $derived(/\/(plans|rooms)/.test(page.url.pathname));

	// 原サイトと同じページ構成（客室/お料理/施設/オプション/山人の四季/よくある質問 + アクセス）
	const nav = $derived([
		{ href: `${base}/rooms`, label: '客室' },
		{ href: `${base}/cuisine`, label: 'お料理' },
		{ href: `${base}/facility`, label: '施設' },
		{ href: `${base}/option`, label: 'オプション' },
		{ href: `${base}/shiki`, label: '山人の四季' },
		{ href: `${base}/faq`, label: 'よくある質問' }
	]);
</script>

<div class="yamado-site min-h-screen bg-white">
	<!-- ヘッダー（fixed・白80%・ロゴ130px） -->
	<header class="fixed left-0 top-0 z-50 w-full bg-white/80 backdrop-blur-[2px]">
		<div class="flex items-stretch pl-[20px]">
			<a href={base} class="flex items-center py-[16px]">
				<img src="/site-assets/yamado/logo.png" alt={facility.name} class="h-[50px] w-auto sm:h-[56px]" />
			</a>
			<nav class="ml-auto hidden items-stretch lg:flex">
				<div class="flex items-center">
					{#each nav as item}
						<a href={item.href} class="ml-[24px] whitespace-nowrap text-[16px] text-black transition-colors hover:text-[#b2b2b2] xl:ml-[36px]">{item.label}</a>
					{/each}
					<a href="{base}/access" class="ml-[24px] text-[16px] text-black transition-colors hover:text-[#b2b2b2] xl:ml-[36px]">アクセス</a>
					<!-- 施設間移動・ブランドポータル -->
					<span class="ml-[24px] h-3 w-px bg-stone-300 xl:ml-[32px]"></span>
					{#each facility.siblings as sib}
						<a href="/{sib.brandSlug}/{sib.slug}" class="ml-[16px] whitespace-nowrap text-[13px] text-stone-500 hover:text-black">{sib.name}</a>
					{/each}
					<a href="/" class="ml-[16px] whitespace-nowrap text-[13px] text-stone-500 hover:text-black">{facility.brandName}ポータル</a>
					<a href={user?.role === 'member' ? '/account' : '/auth/login'} class="ml-[18px] text-[14px] text-stone-500 hover:text-black xl:ml-[24px]">
						{user?.role === 'member' ? `${user.name} 様` : '会員ログイン'}
					</a>
				</div>
				<a href="{base}/plans" class="ml-[24px] flex items-center bg-[#e5e5e5] px-[40px] text-[16px] text-black transition-colors hover:bg-[#4d4d4d] hover:text-white xl:px-[55px]">
					<span>ご予約</span>
				</a>
			</nav>
			<!-- モバイル: ハンバーガー -->
			<button type="button" class="ml-auto flex w-[60px] flex-col items-center justify-center gap-1.5 lg:hidden" onclick={() => (menuOpen = true)} aria-label="メニュー">
				<span class="h-px w-6 bg-black"></span>
				<span class="h-px w-6 bg-black"></span>
				<span class="h-px w-6 bg-black"></span>
			</button>
		</div>
	</header>

	<!-- モバイルメニュー（原サイト: 全面 #4d4d4d） -->
	{#if menuOpen}
		<div class="fixed inset-0 z-[60] overflow-y-auto bg-[#4d4d4d]">
			<button type="button" class="absolute right-5 top-5 text-3xl text-white" onclick={() => (menuOpen = false)} aria-label="閉じる">×</button>
			<div class="px-[10.5%] pb-10 pt-[70px]">
				<nav class="flex flex-col gap-6 text-[18px] text-white">
					{#each nav as item}
						<a href={item.href} onclick={() => (menuOpen = false)}>{item.label}</a>
					{/each}
					<a href="{base}/news" onclick={() => (menuOpen = false)}>お知らせ</a>
					<a href="{base}/access" onclick={() => (menuOpen = false)}>アクセス</a>
					<a href="{base}/plans" onclick={() => (menuOpen = false)} class="mt-2 inline-block bg-white/90 px-8 py-3 text-center text-black">ご予約</a>
					<a href={user?.role === 'member' ? '/account' : '/auth/login'} class="text-[14px] text-white/70">{user?.role === 'member' ? 'マイページ' : '会員ログイン'}</a>
					<!-- 山人グループ（施設間移動・ポータル） -->
					<div class="mt-4 border-t border-white/20 pt-4 text-[13px] tracking-[0.2em] text-white/50">{facility.brandName} GROUP</div>
					{#each facility.siblings as sib}
						<a href="/{sib.brandSlug}/{sib.slug}" onclick={() => (menuOpen = false)} class="text-[15px] text-white/90">{sib.name}</a>
					{/each}
					<a href="/" onclick={() => (menuOpen = false)} class="text-[15px] text-white/90">{facility.brandName}ポータル（全施設トップ）</a>
					<a href="/search" onclick={() => (menuOpen = false)} class="text-[14px] text-white/70">{m.searchbar_submit()}（全施設）</a>
				</nav>
			</div>
		</div>
	{/if}

	<!-- 本体（施設トップ=ヒーロー全画面でヘッダーを重ねる / 下層=fixedヘッダー分 88px を空ける） -->
	<main class={isTop ? '' : 'pt-[88px]'}>
		{#if showSearch}
			<div class="border-b border-[#e2e2e2] bg-[#faf9f6]">
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

	<!-- フッター（原サイト: 14px 黒リンク・中央寄せ） -->
	<footer class="mt-20 border-t border-[#e2e2e2] bg-white">
		<div class="mx-auto max-w-[980px] px-4 py-10 text-center">
			<img src="/site-assets/yamado/logo.png" alt={facility.name} class="mx-auto w-[110px]" />
			<p class="mt-4 text-[15px] leading-relaxed text-[#333]">{facility.addressPublic}<br />TEL {facility.phone}</p>
			<nav class="mt-6 flex flex-wrap justify-center gap-x-[35px] gap-y-2">
				{#each nav as item}
					<a href={item.href} class="text-[15px] text-black transition-colors hover:text-[#b2b2b2]">{item.label}</a>
				{/each}
				<a href="{base}/news" class="text-[15px] text-black hover:text-[#b2b2b2]">お知らせ</a>
				<a href="{base}/access" class="text-[15px] text-black hover:text-[#b2b2b2]">アクセス</a>
				<a href={user?.role === 'member' ? '/account' : '/auth/login'} class="text-[15px] text-black hover:text-[#b2b2b2]">マイページ</a>
			</nav>
			<!-- 山人グループ（施設間移動・ブランドポータル） -->
			<nav class="mt-6 flex flex-wrap justify-center gap-x-7 gap-y-2 border-t border-[#eee] pt-6">
				<a href="/" class="text-[14px] font-medium text-[#4a6b52] hover:underline">{facility.brandName}ポータル（全施設）</a>
				<span class="text-[14px] text-stone-400">{facility.name}（このサイト）</span>
				{#each facility.siblings as sib}
					<a href="/{sib.brandSlug}/{sib.slug}" class="text-[14px] text-black hover:text-[#b2b2b2]">{sib.name}</a>
				{/each}
			</nav>
			<nav class="mt-4 flex flex-wrap justify-center gap-x-6">
				<a href="/legal/tokushoho" class="text-[13px] text-stone-400 hover:underline">特定商取引法に基づく表記</a>
				<a href="/legal/privacy" class="text-[13px] text-stone-400 hover:underline">プライバシーポリシー</a>
				<a href="/legal/yakkan" class="text-[13px] text-stone-400 hover:underline">宿泊約款</a>
			</nav>
			<p class="mt-6 text-[12px] text-stone-400">© Yamado Co., Ltd.</p>
		</div>
	</footer>
</div>

<style>
	/* 原サイト実測 16px をベースに、可読性のため 17px へ引き上げ（ユーザー要望） */
	.yamado-site {
		font-family: '游明朝', YuMincho, 'Sawarabi Mincho', 'ヒラギノ明朝 ProN W3', 'Hiragino Mincho ProN', 'HG明朝E', serif;
		font-size: 17px;
		line-height: 1.8;
		color: #333;
	}
	/* 配下コンポーネントの小さめユーティリティも底上げ */
	.yamado-site :global(.text-sm) {
		font-size: 15px;
	}
	.yamado-site :global(.text-xs) {
		font-size: 13.5px;
	}
</style>
