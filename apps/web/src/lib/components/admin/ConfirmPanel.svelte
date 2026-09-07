<script lang="ts">
	// 取り返しのつかない操作の二段確認（docs/ADMIN_APP_OPS.md §3.1 / §3.2）。
	// requireCount を渡すと、その件数を手入力しない限り実行ボタンを有効にしない。
	// フォームの中に置く場合は submit={true} にすると確定ボタンがそのまま submit になる。
	let {
		message,
		requireCount = null,
		confirmLabel,
		submit = false,
		onconfirm = undefined,
		oncancel
	}: {
		message: string;
		requireCount?: number | null;
		confirmLabel: string;
		submit?: boolean;
		onconfirm?: () => void;
		oncancel: () => void;
	} = $props();

	let typed = $state('');
	let ok = $derived(requireCount === null || Number(typed) === requireCount);
</script>

<div class="rounded-xl border border-amber-300 bg-amber-50 p-4">
	<p class="text-sm font-medium text-amber-900">{message}</p>

	{#if requireCount !== null}
		<label class="mt-3 block text-sm text-amber-900">
			確認のため件数「{requireCount}」を入力してください
			<input
				type="text"
				inputmode="numeric"
				bind:value={typed}
				class="ml-2 w-24 rounded-md border border-amber-300 bg-white px-2 py-1 text-sm"
			/>
		</label>
	{/if}

	<div class="mt-3 flex gap-2">
		<button
			type="button"
			class="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700"
			onclick={oncancel}>戻る</button
		>
		<button
			type={submit ? 'submit' : 'button'}
			disabled={!ok}
			class="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
			onclick={submit ? undefined : onconfirm}>{confirmLabel}</button
		>
	</div>
</div>
