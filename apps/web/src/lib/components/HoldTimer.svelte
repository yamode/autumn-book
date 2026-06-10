<script lang="ts">
	import { onMount } from 'svelte';

	let { expiresAt, onexpire }: { expiresAt: number; onexpire?: () => void } = $props();

	let remaining = $state(Math.max(0, expiresAt - Date.now()));

	onMount(() => {
		const t = setInterval(() => {
			remaining = Math.max(0, expiresAt - Date.now());
			if (remaining === 0) {
				clearInterval(t);
				onexpire?.();
			}
		}, 1000);
		return () => clearInterval(t);
	});

	let mm = $derived(String(Math.floor(remaining / 60000)).padStart(2, '0'));
	let ss = $derived(String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0'));
	let warning = $derived(remaining < 5 * 60 * 1000);
</script>

<div class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm {warning ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}">
	<span aria-hidden="true">⏱</span>
	{#if remaining > 0}
		<span>お部屋を確保しています — 残り <strong class="tabular-nums">{mm}:{ss}</strong></span>
	{:else}
		<span>確保時間が終了しました。恐れ入りますが、もう一度お選び直しください。</span>
	{/if}
</div>
