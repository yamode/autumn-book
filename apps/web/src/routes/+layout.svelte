<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import DebugPanel from '$lib/components/DebugPanel.svelte';
	import AnalyticsConsent from '$lib/components/AnalyticsConsent.svelte';
	import PageLoadingBoundary from '$lib/components/PageLoadingBoundary.svelte';
	import { rankName } from '$lib/rank-name';
	import type { RankCode } from '$lib/plan-access';

	let { children } = $props();
	const ranks: RankCode[] = ['standard', 'silver', 'gold', 'platinum'];

	// 取引先専用ページ（/p/<token>）は URL に限定トークンを含むため、アクセス解析（GA4）の読み込みも
	// 同意バナーも出さない（トークンを外部へ送らない）。社外向けの画面なのでデバッグパネルも出さない。
	// 共通ログイン画面（/partner）も取引先向けなので同じ扱い
	const isPartnerPortal = $derived(page.url.pathname.startsWith('/p/') || page.url.pathname === '/partner' || page.url.pathname.startsWith('/partner/'));
	const isBookingMcpConsent = $derived(
		page.url.pathname.startsWith('/booking-mcp/oauth/') || Boolean(page.url.searchParams.get('next')?.startsWith('/booking-mcp/oauth/'))
	);

</script>

{#if page.data.memberPreview}
	<div class="relative z-50 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-amber-100 px-4 py-2 text-sm text-amber-950">
		<div><strong>会員プレビュー</strong><span class="ml-2">検証用データ</span></div>
		<form action="/member-preview/session" method="POST" class="flex flex-wrap items-center gap-2">
			<select name="rank" aria-label="会員ランク" class="min-h-10 rounded-md border border-amber-300 bg-white px-2">
				{#each ranks as rank (rank)}
					<option value={rank} selected={page.data.memberPreview === rank}>{rankName(rank)}</option>
				{/each}
			</select>
			<button class="min-h-10 rounded-md border border-amber-400 px-3">切り替え</button>
			<button name="intent" value="exit" class="min-h-10 px-2 underline underline-offset-4">終了</button>
		</form>
	</div>
{/if}
<PageLoadingBoundary shell="root">{@render children()}</PageLoadingBoundary>
{#if !page.data.memberPreview && !isPartnerPortal && !isBookingMcpConsent}
	<AnalyticsConsent />
	<DebugPanel />
{/if}
