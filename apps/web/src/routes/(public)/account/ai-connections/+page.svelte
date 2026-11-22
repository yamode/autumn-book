<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	let { data } = $props();
</script>

<svelte:head>
	<title>{m.account_ai_page_title()}</title>
</svelte:head>

<section class="rounded-xl border bg-white p-5">
	<h1 class="text-xl font-semibold">{m.account_ai_heading()}</h1>
	<h2 class="mt-4 font-medium">YAMADO · Claude</h2>
	<p class="mt-2">{m.account_ai_claude_intro()}</p>
	<p class="mt-2 text-sm text-gray-600">{m.account_ai_claude_onsite_soon()}</p>
	{#if data.connected}
		<p class="mt-4 text-sm">{m.account_ai_claude_connected()}</p>
		<form method="POST" action="?/disconnect" class="mt-4">
			<button type="submit" class="rounded-lg border px-4 py-2">{m.account_ai_disconnect()}</button>
		</form>
	{:else}
		<p class="mt-4 text-sm">{m.account_ai_claude_not_connected()}</p>
	{/if}
</section>

{#if data.chatGPTConnected}
	<section class="mt-4 rounded-xl border bg-white p-5">
		<h2 class="font-medium">YAMADO · ChatGPT</h2>
		<p class="mt-2">{m.account_ai_chatgpt_connected()}</p>
		<form method="POST" action="?/disconnectChatGPT" class="mt-4">
			<button type="submit" class="rounded-lg border px-4 py-2">{m.account_ai_disconnect()}</button>
		</form>
	</section>
{/if}
