<script lang="ts">
	import { DEBUG, debugLines } from '$lib/debug';

	let open = $state(false);
</script>

{#if DEBUG}
	<!-- リリース時は DEBUG=false で非表示化（削除しない） -->
	<div class="fixed bottom-0 left-0 right-0 z-[9999]">
		<button
			type="button"
			onclick={() => (open = !open)}
			class="ml-2 rounded-t bg-black/75 px-2 py-0.5 font-mono text-[10px] text-green-400"
		>
			DBG {open ? '▼' : '▲'}
		</button>
		{#if open}
			<pre class="max-h-[30vh] overflow-auto bg-black/75 p-1 font-mono text-[10px] leading-tight text-green-400">{$debugLines.join('\n')}</pre>
		{/if}
	</div>
{/if}
