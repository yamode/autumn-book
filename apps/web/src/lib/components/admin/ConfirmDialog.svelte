<script lang="ts">
	import { confirmState, settleConfirm } from './confirm-dialog.svelte';

	let confirmBtn = $state<HTMLButtonElement | null>(null);
	$effect(() => {
		if (confirmState.current) confirmBtn?.focus();
	});
</script>

<svelte:window
	onkeydown={(e) => {
		if (confirmState.current && e.key === 'Escape') settleConfirm(false);
	}}
/>

{#if confirmState.current}
	{@const c = confirmState.current}
	<div class="fixed inset-0 z-[60] flex items-center justify-center p-4" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-msg">
		<button type="button" class="absolute inset-0 bg-black/40" aria-label="閉じる" onclick={() => settleConfirm(false)}></button>
		<div class="relative w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
			<p id="confirm-dialog-msg" class="text-sm whitespace-pre-line text-stone-800">{c.message}</p>
			<div class="mt-5 flex justify-end gap-2">
				<button type="button" class="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50" onclick={() => settleConfirm(false)}>戻る</button>
				<button
					bind:this={confirmBtn}
					type="button"
					class="rounded-lg px-4 py-2 text-sm font-medium text-white {c.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-800 hover:bg-brand-700'}"
					onclick={() => settleConfirm(true)}>{c.confirmLabel ?? '実行する'}</button
				>
			</div>
		</div>
	</div>
{/if}
