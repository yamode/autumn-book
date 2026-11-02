<script lang="ts">
	// 予約入力画面の見出しと「1. 入力 → 2. 確認・確定」の印（取引先ページと公式サイトで共通・2026-11-02）。
	// level = 見出しの階層（レイアウトに h1 がある取引先ページは 2）
	let {
		step,
		heading,
		inputLabel,
		confirmLabel,
		level = 1
	}: { step: 'input' | 'confirm'; heading: string; inputLabel: string; confirmLabel: string; level?: 1 | 2 } = $props();
</script>

<svelte:element this={level === 2 ? 'h2' : 'h1'} class="mt-2 text-2xl font-bold">{heading}</svelte:element>
<ol class="mt-3 flex gap-2 text-sm">
	<li class="rounded-full px-3 py-1 {step === 'input' ? 'bg-brand-900 text-white' : 'bg-stone-200 text-stone-500'}" aria-current={step === 'input' ? 'step' : undefined}>{inputLabel}</li>
	<li class="rounded-full px-3 py-1 {step === 'confirm' ? 'bg-brand-900 text-white' : 'bg-stone-200 text-stone-500'}" aria-current={step === 'confirm' ? 'step' : undefined}>{confirmLabel}</li>
</ol>
