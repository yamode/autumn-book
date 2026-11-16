<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>AI連携 | 山人Book</title>
</svelte:head>

<section class="rounded-xl border bg-white p-5">
	<h1 class="text-xl font-semibold">AI連携</h1>
	<h2 class="mt-4 font-medium">YAMADO · Claude</h2>
	{#if data.connected}
		<p class="mt-2">空室・料金の検索を許可しています。</p>
		<form method="POST" action="?/disconnect" class="mt-4">
			<button type="submit" class="rounded-lg border px-4 py-2">連携を解除する</button>
		</form>
	{:else}
		<p class="mt-2">連携していません。新規連携はClaudeのコネクター設定から行います。</p>
	{/if}
	{#if data.reservationConnected}
		<h2 class="mt-6 font-medium">YAMADO · Claude 現地払い予約</h2>
		<p class="mt-2">空室検索と、確認カードからの現地払い予約を許可しています。</p>
		<form method="POST" action="?/disconnectReservations" class="mt-4">
			<button type="submit" class="rounded-lg border px-4 py-2">予約連携を解除する</button>
		</form>
	{/if}
	{#if data.pilotConnected}
		<h2 class="mt-6 font-medium">YAMADO · Claude 現地払い予約（試験連携）</h2>
		<p class="mt-2">空室検索と、確認カードからの現地払い予約を許可しています。</p>
		<form method="POST" action="?/disconnectPilot" class="mt-4">
			<button type="submit" class="rounded-lg border px-4 py-2">試験連携を解除する</button>
		</form>
	{/if}
</section>
