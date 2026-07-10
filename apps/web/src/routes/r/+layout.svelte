<script lang="ts">
	// 客室電子インフォメーション（ゲスト面）の最小シェル。上品な和風トーン・モバイルファースト。
	// /r は (public) グループ外の独立ルート。検索エンジンには載せない（noindex）。
	import LocaleSwitcher from '$lib/components/LocaleSwitcher.svelte';
	import * as m from '$lib/paraglide/messages';

	let { children } = $props();
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="min-h-screen bg-stone-50 text-stone-800">
	<header class="border-b border-stone-200 bg-white">
		<div class="mx-auto flex max-w-md items-center justify-between px-4 py-3">
			<span class="font-display text-brand-900">
				YAMADO <span class="ml-1 text-xs font-normal text-stone-400">{m.inroom_header()}</span>
			</span>
			<LocaleSwitcher />
		</div>
	</header>

	<main class="mx-auto max-w-md px-4 py-6">
		{@render children()}
	</main>
</div>
