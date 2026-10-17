<script lang="ts">
	// 客室案内（/admin/inroom 配下）の共通のタブ（2026-10-17 指示: どのメニューからでも同じ位置で切り替えられるように）。
	// 館内案内・客室スリップは同じ画面（/admin/inroom）を ?tab で切り替える。ほかはそれぞれの画面へのリンク。
	// 印刷用のスリップ（/admin/inroom/slip/[id]）にはタブを出さない。入口QRの印刷ではタブを隠す（print-hide）。
	import { page } from '$app/state';

	let { children } = $props();

	const TABS = [
		{ key: 'guides', href: '/admin/inroom', label: '📖 館内案内' },
		{ key: 'slips', href: '/admin/inroom?tab=slips', label: '🎫 客室スリップ' },
		{ key: 'banners', href: '/admin/inroom/banners', label: '🎁 サンクスページのバナー' },
		{ key: 'entry', href: '/admin/inroom/entry', label: '🖨 入口QR（客室に常設）' },
		{ key: 'billing', href: '/admin/inroom/billing', label: '💴 精算案内' },
		{ key: 'preview', href: '/admin/inroom/preview', label: '📱 プレビュー' },
		{ key: 'access', href: '/admin/inroom/access', label: '📈 アクセスログ' }
	] as const;

	const path = $derived(page.url.pathname.replace(/\/$/, ''));
	const showTabs = $derived(!path.startsWith('/admin/inroom/slip'));
	const active = $derived.by(() => {
		if (path === '/admin/inroom') {
			const q = page.url.searchParams;
			return q.get('tab') === 'slips' || q.get('all') ? 'slips' : 'guides';
		}
		return path.split('/')[3] ?? '';
	});
</script>

{#if showTabs}
	<nav class="print-hide mb-5 flex gap-1 overflow-x-auto border-b border-stone-200 print:hidden" aria-label="客室案内のメニュー">
		{#each TABS as t (t.key)}
			<a
				href={t.href}
				aria-current={active === t.key ? 'page' : undefined}
				data-sveltekit-noscroll
				class="shrink-0 border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap {active === t.key
					? 'border-brand-800 text-brand-900'
					: 'border-transparent text-stone-400 hover:text-stone-600'}">{t.label}</a
			>
		{/each}
	</nav>
{/if}

{@render children()}
