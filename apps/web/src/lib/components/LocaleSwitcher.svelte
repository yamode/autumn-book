<script lang="ts">
	import { page } from '$app/state';
	import { getLocale, localizeHref, type Locale } from '$lib/paraglide/runtime';

	// 現在のロケールを取得（リアクティブに参照）
	let locale = $derived(getLocale());

	// ロケールの表示ラベル
	const labels: Record<string, string> = {
		ja: 'JA',
		en: 'EN',
		'zh-TW': '繁體'
	};

	// 対応ロケール一覧（型付き）
	const locales: Locale[] = ['ja', 'en', 'zh-TW'];

	// 各ロケールへの遷移URL（現在のパスを維持）
	function hrefFor(target: Locale): string {
		return localizeHref(page.url.pathname + page.url.search, { locale: target });
	}
</script>

<!-- 言語スイッチャ（設計書 §3）: 地球儀アイコン + ロケールリンク -->
<div class="flex items-center gap-1 text-xs text-stone-500">
	<span aria-hidden="true" class="text-base">🌐</span>
	{#each locales as loc}
		{#if loc === locale}
			<span class="font-medium text-brand-900">{labels[loc]}</span>
		{:else}
			<a href={hrefFor(loc)} class="hover:text-brand-800">{labels[loc]}</a>
		{/if}
		{#if loc !== 'zh-TW'}
			<span class="text-stone-300">|</span>
		{/if}
	{/each}
</div>
