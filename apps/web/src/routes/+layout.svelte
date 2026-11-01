<script lang="ts">
	import '../app.css';
	import { navigating, page } from '$app/state';
	import DebugPanel from '$lib/components/DebugPanel.svelte';
	import AnalyticsConsent from '$lib/components/AnalyticsConsent.svelte';

	let { children } = $props();

	// 取引先専用ページ（/p/<token>）は URL に限定トークンを含むため、アクセス解析（GA4）の読み込みも
	// 同意バナーも出さない（トークンを外部へ送らない）。社外向けの画面なのでデバッグパネルも出さない。
	// 共通ログイン画面（/partner）も取引先向けなので同じ扱い
	const isPartnerPortal = $derived(page.url.pathname.startsWith('/p/') || page.url.pathname === '/partner' || page.url.pathname.startsWith('/partner/'));
</script>

{@render children()}
<!-- 画面を移っている間、上端に細い帯を出す（押したことがすぐ分かるように）。150ms 以内に終わる遷移では出さない。
     もとは管理画面だけ（2026-10-18）→ 全画面共通に（2026-11-01・見た目は app.css の .nav-progress） -->
{#if navigating.to}
	<div class="nav-progress pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden" aria-hidden="true"><div class="h-full w-1/3 bg-amber-500"></div></div>
{/if}
{#if !isPartnerPortal}
	<AnalyticsConsent />
	<DebugPanel />
{/if}
