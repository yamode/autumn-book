<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { onMount } from 'svelte';
	import DebugPanel from '$lib/components/DebugPanel.svelte';
	import AnalyticsConsent from '$lib/components/AnalyticsConsent.svelte';
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

	// 画面を移っている間は、押したボタン・リンクに data-pending を付ける（見た目は app.css: ボタンは中で回転、文字のリンクは色が変わる）。
	// 2026-11-01 指示「ローディングは画面上部ではなく、ボタンならボタンの中でぐるぐる」（上端の帯は廃止）。
	// 押したものは 1.5 秒だけ覚える（あとから JS で goto した遷移に、昔押したボタンを光らせない）
	let pressed: { el: HTMLElement; at: number } | null = null;
	let marked: HTMLElement | null = null;
	const clearMark = () => {
		marked?.removeAttribute('data-pending');
		marked = null;
	};
	onMount(() => {
		const onClick = (e: MouseEvent) => {
			const el = (e.target as Element | null)?.closest<HTMLElement>('a[href], button');
			pressed = el ? { el, at: Date.now() } : null;
		};
		document.addEventListener('click', onClick, true);
		return () => document.removeEventListener('click', onClick, true);
	});
	beforeNavigate(({ willUnload, type }) => {
		if (willUnload || type === 'popstate' || !pressed || Date.now() - pressed.at > 1500 || !pressed.el.isConnected) return;
		clearMark();
		marked = pressed.el;
		marked.setAttribute('data-pending', '');
		// 遷移が取り消された・失敗したときにも残らないよう、念のため 15 秒で外す
		const el = marked;
		setTimeout(() => el.removeAttribute('data-pending'), 15000);
	});
	afterNavigate(() => {
		clearMark();
		pressed = null;
	});
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
{@render children()}
{#if !page.data.memberPreview && !isPartnerPortal && !isBookingMcpConsent}
	<AnalyticsConsent />
	<DebugPanel />
{/if}
