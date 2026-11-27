<script lang="ts">
	// 子のページの上部の「‹ 〇〇に戻る」。小さな灰色のパンくずリストだけでは戻り方が分かりづらかったため、
	// 押しやすい大きさ（高さ 44px）の 1 本の戻るリンクに置き換えた（2026-11-21 指示）。戻り先は各ページが決める（どこから来たか）。
	import * as m from '$lib/paraglide/messages';

	let { href, target, inline = false }: { href: string; /** 戻り先の名前（「客室・プラン一覧」など） */ target: string; inline?: boolean } = $props();
</script>

<nav aria-label={m.common_back()} class={inline ? 'ml-auto' : '-ml-2 mb-3'}>
	<a {href} class="inline-flex min-h-11 max-w-full items-center gap-1 rounded-lg px-2 text-sm font-medium text-brand-800 hover:bg-stone-100">
		<svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
		<span class="truncate">{m.common_back_to({ target })}</span>
	</a>
</nav>
