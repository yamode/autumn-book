<script lang="ts">
	// 公式マイページ: 滞在アレンジの追加。入力フォームは lib/components/booking/OptionOrderForm.svelte（特別会員の専用ページと共用）
	import * as m from '$lib/paraglide/messages';
	import OptionOrderForm from '$lib/components/booking/OptionOrderForm.svelte';

	let { data, form } = $props();
</script>

<svelte:head><title>{m.options_page_title()}</title></svelte:head>

<nav class="mb-4 text-xs text-stone-400">
	<a href="/account" class="hover:underline">{m.reservation_breadcrumb_list()}</a> /
	<a href="/account/reservations/{data.code}" class="hover:underline">{data.code}</a> /
	{m.options_add()}
</nav>

<h1 class="text-xl font-semibold text-brand-900">{m.options_heading()}</h1>
<p class="mt-1 text-sm text-stone-500">{m.options_lead()}</p>

{#if form?.message}
	<p class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{form.message}</p>
{/if}

<OptionOrderForm {data} />
