<script lang="ts">
	// 貸切風呂のご予約の前のコード入力（2026-10-10）。入れると滞在に紐づき、予約フォーム（/r/bath）へ進む。
	import * as m from '$lib/paraglide/messages';
	import StayCodeInput from '$lib/components/StayCodeInput.svelte';

	let { form } = $props();
</script>

<svelte:head><title>{m.bath_title()} ｜ YAMADO</title></svelte:head>

<div class="space-y-3 px-4 py-4">
	{#if form?.claimError === 'fail'}
		<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{m.inroom_err_code()}</p>
	{:else if form?.claimError === 'locked'}
		<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{m.inroom_err_locked()}</p>
	{/if}
	<section class="rounded-lg bg-white px-4 py-5" style="box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1)">
		<h1 class="text-[15px] font-medium text-stone-900">{m.inroom_code_title()}</h1>
		<p class="mt-1 text-sm text-stone-500">{m.bath_code_help()}</p>
		<StayCodeInput autofocus />
	</section>
</div>
