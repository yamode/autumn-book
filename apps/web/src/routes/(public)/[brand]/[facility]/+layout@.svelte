<script lang="ts">
	// 施設サイトは共通ヘッダーを使わず、各サイト固有のヘッダー/フッターで包む（@でルートレイアウトへリセット）。
	// 機能（予約・会員・検索）は各ヘッダーのボタンから共通UIへ入る。
	import YamadoShell from '$lib/site/YamadoShell.svelte';
	import OgaShell from '$lib/site/OgaShell.svelte';
	import StandardShell from '$lib/site/StandardShell.svelte';

	let { data, children } = $props();
	let f = $derived(data.shellFacility);
</script>

{#if f.template === 'yamado-v1'}
	<YamadoShell facility={f} user={data.user}>
		{@render children()}
	</YamadoShell>
{:else if f.template === 'oga-v1'}
	<OgaShell facility={f} user={data.user}>
		{@render children()}
	</OgaShell>
{:else}
	<StandardShell facility={f} user={data.user}>
		{@render children()}
	</StandardShell>
{/if}
