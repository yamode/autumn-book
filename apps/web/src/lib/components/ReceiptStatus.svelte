<script lang="ts">
	import type { ReceiptTracking } from '$lib/server/inroom-receipt-tracking';
	let { tracking, isTest = false }: { tracking?: ReceiptTracking; isTest?: boolean } = $props();
	const fmt = (s: string) => new Intl.DateTimeFormat('ja-JP', {
		month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo'
	}).format(new Date(s));
</script>

<div class="mt-2 space-y-0.5 text-xs text-stone-600">
	{#if isTest}
		<p>領収書：対象外（テスト決済）</p>
	{:else if tracking?.downloadedAt || tracking?.emailedAt}
		<p class="font-medium text-emerald-800">領収書：発行済み</p>
		{#if tracking.downloadedAt}<p>PDF提供 {fmt(tracking.downloadedAt)}</p>{/if}
		{#if tracking.emailedAt}<p>メール送信 {fmt(tracking.emailedAt)}</p>{/if}
	{:else if tracking?.trackingStartedAt}
		<p>領収書：未発行</p>
	{:else}
		<p>領収書：履歴なし・確認不可</p>
	{/if}
</div>
