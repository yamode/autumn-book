<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>YAMADO | Claudeとの連携</title>
</svelte:head>

<main class="mx-auto max-w-md px-6 py-12">
	<img src={data.icon} alt="山人" width="64" height="64" class="mb-5 rounded-lg" />
	<h1 class="text-2xl font-semibold">YAMADOをClaudeに連携</h1>
	{#if data.onsite}
		{#if data.pilot}<p class="mt-4 font-medium">現地払い予約の試験連携</p>{/if}
		<p class="mt-4">Claudeに、西和賀・男鹿の空室・料金を検索し、現地払いの予約を確定する権限を許可します。あなたが確認カードで同意し、確定ボタンを押したときに、山人Bookが会員情報を使って予約を確定します。</p>
		<p class="mt-3 text-sm">事前決済が必要なプランは、山人Bookで予約とお支払いを行います。</p>
	{:else}
		<p class="mt-4">Claudeに、西和賀・男鹿の空室と、あなたがBookで予約できるプランの料金を検索する権限を許可します。予約の確定・お支払いは山人Bookで行います。</p>
	{/if}
	<p class="mt-3 text-sm">連携は解除するまで有効です。マイページの「AI連携」からいつでも解除できます。</p>
	<form method="POST" class="mt-6 flex flex-wrap gap-3">
		<button type="submit" name="decision" value="allow" class="rounded-lg bg-brand-800 px-4 py-2 text-white">連携を許可する</button>
		<button type="submit" name="decision" value="deny" class="rounded-lg border px-4 py-2">許可しない</button>
	</form>
</main>
