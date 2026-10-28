<script lang="ts">
	import { page } from '$app/state';
	import { getLocale, localizeHref, type Locale } from '$lib/paraglide/runtime';

	// dark: 客室案内の黒いヘッダー上で使うときの配色
	let { dark = false }: { dark?: boolean } = $props();

	// 現在のロケールを取得（リアクティブに参照）
	let locale = $derived(getLocale());

	// ロケールの表示ラベル
	const labels: Record<string, string> = {
		ja: '日本語',
		en: 'English',
		'zh-TW': '繁體中文'
	};

	// 対応ロケール一覧（型付き）
	const locales: Locale[] = ['ja', 'en', 'zh-TW'];

	// 各ロケールへの遷移URL（現在のパスを維持）
	function hrefFor(target: Locale): string {
		return localizeHref(page.url.pathname + page.url.search, { locale: target });
	}

	let root: HTMLDetailsElement | undefined = $state();

	// メニューの外を押したら閉じる
	function onWindowClick(e: MouseEvent) {
		if (root?.open && !root.contains(e.target as Node)) root.open = false;
	}
</script>

<svelte:window onclick={onWindowClick} />

<!-- 言語スイッチャ: 選んでいる言語だけを表示し、押すと一覧が開くドロップダウン -->
<details bind:this={root} class="relative text-xs">
	<summary
		aria-label="Language"
		class="flex cursor-pointer list-none items-center gap-1 rounded-full border px-2.5 py-1.5 [&::-webkit-details-marker]:hidden {dark
			? 'border-stone-500 text-white'
			: 'border-stone-300 text-stone-700'}"
	>
		<span aria-hidden="true" class="text-sm">🌐</span>
		<span class="font-medium">{labels[locale]}</span>
		<svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
			<path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	</summary>
	<ul class="absolute right-0 top-full z-50 mt-1 min-w-[8rem] overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
		{#each locales as loc (loc)}
			<li>
				{#if loc === locale}
					<span class="flex items-center justify-between gap-3 bg-stone-50 px-3 py-2 font-medium text-stone-900">
						{labels[loc]}<span aria-hidden="true">✓</span>
					</span>
				{:else}
					<a href={hrefFor(loc)} data-sveltekit-reload class="block px-3 py-2 text-stone-700 hover:bg-stone-50">{labels[loc]}</a>
				{/if}
			</li>
		{/each}
	</ul>
</details>
