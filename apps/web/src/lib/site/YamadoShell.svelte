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
	// プラン・客室ページでは検索条件バー（共通機能への入口）を出す
	let showSearch = $derived(/\/(plans|rooms)/.test(page.url.pathname));

	const nav = $derived([
		{ href: `${base}#rooms`, label: '客室' },
		{ href: `${base}#reason`, label: 'お料理' },
		{ href: `${base}/plans`, label: 'プラン' },
		{ href: `${base}/news`, label: 'お知らせ' },
		{ href: `${base}#faq`, label: 'よくある質問' }
	]);
</script>

<div class="yamado-site min-h-screen bg-white">
	<!-- ヘッダー（fixed・白80%・ロゴ130px） -->
	<header class="fixed left-0 top-0 z-50 w-full bg-white/80 backdrop-blur-[2px]">
		<div class="flex items-stretch pl-[20px]">
			<a href={base} class="block w-[130px] min-w-[130px] py-[14px]">
				<img src="https://yamado.co.jp/yamado/wp/wp-content/themes/yamado/common/img/common/logo.png" alt={facility.name} class="w-full" />
			</a>
			<nav class="ml-auto hidden items-stretch lg:flex">
				<div class="flex items-center">
					{#each nav as item}
						<a href={item.href} class="ml-[40px] whitespace-nowrap text-[15px] text-black transition-colors hover:text-[#b2b2b2]">{item.label}</a>
					{/each}
					<a href="{base}#access" class="ml-[40px] text-[15px] text-black transition-colors hover:text-[#b2b2b2]">アクセス</a>
					<a href={user?.role === 'member' ? '/account' : '/auth/login'} class="ml-[30px] text-[13px] text-stone-500 hover:text-black">
						{user?.role === 'member' ? `${user.name} 様` : '会員ログイン'}
					</a>
				</div>
				<a href="{base}/plans" class="ml-[40px] flex items-center bg-[#e5e5e5] px-[55px] text-[16px] text-black transition-colors hover:bg-[#4d4d4d] hover:text-white">
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
				<nav class="flex flex-col gap-6 text-[16px] text-white">
					{#each nav as item}
						<a href={item.href} onclick={() => (menuOpen = false)}>{item.label}</a>
					{/each}
					<a href="{base}#access" onclick={() => (menuOpen = false)}>アクセス</a>
					<a href="{base}/plans" onclick={() => (menuOpen = false)} class="mt-2 inline-block bg-white/90 px-8 py-3 text-center text-black">ご予約</a>
					<a href={user?.role === 'member' ? '/account' : '/auth/login'} class="text-[14px] text-white/70">{user?.role === 'member' ? 'マイページ' : '会員ログイン'}</a>
					<a href="/search" class="text-[14px] text-white/70">{m.searchbar_submit()}（全施設）</a>
				</nav>
			</div>
		</div>
	{/if}

	<!-- 本体（fixedヘッダー分の余白） -->
	<main class="pt-[68px]">
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
			<img src="https://yamado.co.jp/yamado/wp/wp-content/themes/yamado/common/img/common/logo.png" alt={facility.name} class="mx-auto w-[110px]" />
			<p class="mt-4 text-[13px] leading-relaxed text-[#333]">{facility.addressPublic}<br />TEL {facility.phone}</p>
			<nav class="mt-6 flex flex-wrap justify-center gap-x-[35px] gap-y-2">
				{#each nav as item}
					<a href={item.href} class="text-[14px] text-black transition-colors hover:text-[#b2b2b2]">{item.label}</a>
				{/each}
				<a href={user?.role === 'member' ? '/account' : '/auth/login'} class="text-[14px] text-black hover:text-[#b2b2b2]">マイページ</a>
			</nav>
			<nav class="mt-4 flex flex-wrap justify-center gap-x-6">
				<a href="/legal/tokushoho" class="text-[12px] text-stone-400 hover:underline">特定商取引法に基づく表記</a>
				<a href="/legal/privacy" class="text-[12px] text-stone-400 hover:underline">プライバシーポリシー</a>
				<a href="/legal/yakkan" class="text-[12px] text-stone-400 hover:underline">宿泊約款</a>
			</nav>
			<p class="mt-6 text-[11px] text-stone-400">© Yamado Co., Ltd.</p>
		</div>
	</footer>
</div>

<style>
	/* 原サイト実測: body 16px / line-height 1.6 / 游明朝 / #333 */
	.yamado-site {
		font-family: '游明朝', YuMincho, 'Sawarabi Mincho', 'ヒラギノ明朝 ProN W3', 'Hiragino Mincho ProN', 'HG明朝E', serif;
		font-size: 16px;
		line-height: 1.6;
		color: #333;
	}
</style>
