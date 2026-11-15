<svelte:head>
	<title>YAMADO | Claudeとの連携</title>
</svelte:head>

<main class="mx-auto max-w-md px-6 py-12">
	<h1 class="text-2xl font-semibold">YAMADOをClaudeに連携</h1>
	<p class="mt-4">Claudeに、西和賀・男鹿の空室と、あなたがBookで予約できるプランの料金を検索する権限を許可します。予約の確定・お支払いは山人Bookで行います。</p>
	<p class="mt-3 text-sm">連携は30日間有効です。マイページの「AI連携」からいつでも解除できます。</p>
	<form method="POST" class="mt-6 flex flex-wrap gap-3">
		<button type="submit" name="decision" value="allow" class="rounded-lg bg-brand-800 px-4 py-2 text-white">連携を許可する</button>
		<button type="submit" name="decision" value="deny" class="rounded-lg border px-4 py-2">許可しない</button>
	</form>
</main>
