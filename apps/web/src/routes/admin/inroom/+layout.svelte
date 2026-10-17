<script lang="ts">
	// 客室案内（/admin/inroom 配下）の共通のタブ（2026-10-17 指示: どのメニューからでも同じ位置で切り替えられるように）。
	// 並びと現在地はサイドバーと同じ（$lib/admin-nav.ts の「客室案内」の子・メニュー整理 2026-10-17）。
	// /admin/inroom は ?tab で きょうの運用（なし）／館内案内の内容／客室スリップ／表示の設定 を切り替える。
	// 印刷用のスリップ（/admin/inroom/slip/[id]）にはタブを出さない。入口QRの印刷ではタブを隠す（print-hide）。
	// スマホでは横にスクロールし、いまのタブが見えるところまで送る。
	import { page } from '$app/state';
	import { ADMIN_NAV, activeNav } from '$lib/admin-nav';

	let { children } = $props();

	const TABS = ADMIN_NAV.flatMap((g) => g.items).find((i) => i.href === '/admin/inroom')?.children ?? [];
	const path = $derived(page.url.pathname.replace(/\/$/, ''));
	const showTabs = $derived(!path.startsWith('/admin/inroom/slip'));
	const active = $derived(activeNav(page.url.pathname, page.url.searchParams)?.leaf.href ?? '');

	let bar = $state<HTMLElement | null>(null);
	$effect(() => {
		void active;
		bar?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
	});
</script>

{#if showTabs}
	<nav
		bind:this={bar}
		class="print-hide -mx-3 mb-5 flex gap-1 overflow-x-auto border-b border-stone-200 px-3 [scrollbar-width:none] sm:mx-0 sm:px-0 print:hidden [&::-webkit-scrollbar]:hidden"
		aria-label="客室案内のメニュー"
	>
		{#each TABS as t (t.href)}
			<a
				href={t.href}
				aria-current={active === t.href ? 'page' : undefined}
				data-sveltekit-noscroll
				class="-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition sm:px-4 {active === t.href
					? 'border-stone-900 font-semibold text-stone-900'
					: 'border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-700'}">{t.label}</a
			>
		{/each}
	</nav>
{/if}

{@render children()}
