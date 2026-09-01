<script lang="ts">
	// 客室電子インフォメーション（ゲスト面）のシェル。
	//
	// 見た目・操作感は、現行の客室インフォメーション（talkappi VERY travel）を踏襲する:
	//   ・黒の固定ヘッダー（40px）。トップは施設名、下層は戻る矢印＋中央タイトル
	//   ・淡いグレーの地に、白の角丸カードを並べる（max-w-md のモバイル幅）
	//   ・下端の固定タブバー（トップ／貸切風呂）
	// 各ページの load が headerTitle / headerBack を返す（無ければ施設名にフォールバック）。
	//
	// /r は (public) グループ外の独立ルート。検索エンジンには載せない（noindex）。
	import { page } from '$app/state';
	import LocaleSwitcher from '$lib/components/LocaleSwitcher.svelte';
	import * as m from '$lib/paraglide/messages';

	let { children } = $props();

	const title = $derived(
		(page.data.headerTitle as string | undefined) ??
			(page.data.stay as { facility: { name: string } } | null | undefined)?.facility.name ??
			m.inroom_header()
	);
	const back = $derived(page.data.headerBack as string | undefined);
	const path = $derived(page.url.pathname);
	// 滞在が確定している画面（/r で claim 済み・/r/bath・案内の詳細）だけタブを2本出す。
	const bathEnabled = $derived(Boolean(page.data.stay ?? page.data.ctx));
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="min-h-screen bg-inroom text-stone-900">
	<div class="mx-auto flex min-h-screen max-w-md flex-col bg-inroom shadow-sm">
		<!-- ===== ヘッダー（黒・固定） ===== -->
		<header class="sticky top-0 z-30 flex h-10 items-center bg-black pl-5 pr-3 text-white">
			{#if back}
				<a href={back} aria-label="戻る" class="-ml-2 flex h-10 w-10 items-center justify-center">
					<svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round" />
					</svg>
				</a>
				<span class="flex-1 truncate text-center text-[15px]">{title}</span>
				<span class="h-10 w-10"></span>
			{:else}
				<span class="flex-1 truncate text-[15px]">{title}</span>
				<LocaleSwitcher />
			{/if}
		</header>

		<main class="flex-1 pb-16">
			{@render children()}
		</main>

		<!-- ===== 下端タブバー（固定） ===== -->
		<nav
			class="fixed bottom-0 z-30 mx-auto flex h-14 w-full max-w-md items-stretch border-t border-stone-200 bg-white"
		>
			<a
				href="/r"
				class="flex flex-1 flex-col items-center justify-center gap-0.5 {path === '/r'
					? 'text-stone-900'
					: 'text-stone-400'}"
			>
				<svg viewBox="0 0 24 24" class="h-5 w-5" fill="currentColor" aria-hidden="true">
					<path d="M12 3.2 3.5 10.2V21h6v-6h5v6h6V10.2z" />
				</svg>
				<span class="text-[10px]">{m.inroom_tab_top()}</span>
			</a>
			{#if bathEnabled}
				<a
					href="/r/bath"
					class="flex flex-1 flex-col items-center justify-center gap-0.5 {path.startsWith('/r/bath')
						? 'text-stone-900'
						: 'text-stone-400'}"
				>
					<svg viewBox="0 0 24 24" class="h-5 w-5" fill="currentColor" aria-hidden="true">
						<path
							d="M5 11V6.5a2.5 2.5 0 0 1 4.6-1.35l.5.75-1.3.9-.5-.75A.9.9 0 0 0 6.6 6.5V11H21v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-3zM4 20.2c1 .6 2 .8 3 .8h10c1 0 2-.2 3-.8"
						/>
					</svg>
					<span class="text-[10px]">{m.bath_tab()}</span>
				</a>
			{/if}
		</nav>
	</div>
</div>

<style>
	/* VERY travel の地色（淡いグレー）。カードの白との対比をそのまま写している。 */
	:global(.bg-inroom) {
		background-color: #ebedf2;
	}
</style>
