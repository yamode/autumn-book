<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { onMount } from 'svelte';
	import DebugPanel from '$lib/components/DebugPanel.svelte';
	import AnalyticsConsent from '$lib/components/AnalyticsConsent.svelte';

	let { children } = $props();

	// 取引先専用ページ（/p/<token>）は URL に限定トークンを含むため、アクセス解析（GA4）の読み込みも
	// 同意バナーも出さない（トークンを外部へ送らない）。社外向けの画面なのでデバッグパネルも出さない。
	// 共通ログイン画面（/partner）も取引先向けなので同じ扱い
	const isPartnerPortal = $derived(page.url.pathname.startsWith('/p/') || page.url.pathname === '/partner' || page.url.pathname.startsWith('/partner/'));

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

{@render children()}
{#if !isPartnerPortal}
	<AnalyticsConsent />
	<DebugPanel />
{/if}
