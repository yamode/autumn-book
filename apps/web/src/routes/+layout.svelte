<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import DebugPanel from '$lib/components/DebugPanel.svelte';
	import AnalyticsConsent from '$lib/components/AnalyticsConsent.svelte';

	let { children } = $props();

	// 取引先専用ページ（/p/<token>）は URL に限定トークンを含むため、アクセス解析（GA4）の読み込みも
	// 同意バナーも出さない（トークンを外部へ送らない）。社外向けの画面なのでデバッグパネルも出さない。
	const isPartnerPortal = $derived(page.url.pathname.startsWith('/p/'));
</script>

{@render children()}
{#if !isPartnerPortal}
	<AnalyticsConsent />
	<DebugPanel />
{/if}
