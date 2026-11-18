<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>AI連携 | 山人Book</title>
</svelte:head>

<section class="rounded-xl border bg-white p-5">
	<h1 class="text-xl font-semibold">AI連携</h1>
	<h2 class="mt-4 font-medium">YAMADO · Claude</h2>
	<p class="mt-2">Claudeで空室と宿泊料金を検索できます。候補を選んだら、公式予約リンクから山人Bookを開いて予約を確定します。</p>
	<p class="mt-2 text-sm text-gray-600">Claude内で現地払いの予約を確定する機能は、公開に向けて準備中です。</p>
	{#if data.connected}
		<p class="mt-4 text-sm">連携済み · 空室・料金の検索を許可しています。</p>
		<form method="POST" action="?/disconnect" class="mt-4">
			<button type="submit" class="rounded-lg border px-4 py-2">連携を解除する</button>
		</form>
	{:else}
		<p class="mt-4 text-sm">未連携 · Claudeのコネクター設定からYAMADOを追加できます。</p>
	{/if}
</section>

{#if data.chatGPTConnected}
	<section class="mt-4 rounded-xl border bg-white p-5">
		<h2 class="font-medium">YAMADO · ChatGPT</h2>
		<p class="mt-2">空室・料金の検索を許可しています。</p>
		<form method="POST" action="?/disconnectChatGPT" class="mt-4">
			<button type="submit" class="rounded-lg border px-4 py-2">連携を解除する</button>
		</form>
	</section>
{/if}
