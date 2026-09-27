<script lang="ts">
	import { todayStr, addDays, formatDate } from '$lib/format';
	import ScrollDatePicker from '$lib/components/ScrollDatePicker.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		checkin = '',
		nights = 1,
		adults = 2,
		action = '/search',
		large = false
	}: { checkin?: string; nights?: number; adults?: number; action?: string; large?: boolean } = $props();

	// 検索フォームの初期値を props から取り込み、以降はユーザー入力でローカル編集する（意図的な初期化）
	// svelte-ignore state_referenced_locally
	let ci = $state(checkin);
	// svelte-ignore state_referenced_locally
	let n = $state(nights);
	// svelte-ignore state_referenced_locally
	let a = $state(adults);
	let pickerOpen = $state(false);
	const minDate = todayStr();
	const maxDate = addDays(todayStr(), 365);
	// 泊数は最大7泊（一週間の滞在まで）。人数は大人のみ（施設は基本的に子ども不可のため子ども人数は選ばせない）
	const nightOptions = [1, 2, 3, 4, 5, 6, 7];
</script>

<form
	method="GET"
	{action}
	class={large
		? 'grid w-full grid-cols-2 items-end gap-3 border border-stone-200 bg-white p-4 sm:grid-cols-[2fr_1fr_1fr_1.2fr] sm:gap-4 sm:p-5'
		: 'flex flex-wrap items-end gap-2'}
>
	<div class="flex min-w-0 flex-col gap-1 text-xs text-stone-500 {large ? 'col-span-2 sm:col-span-1' : ''}">
		<span>{m.searchbar_checkin()}</span>
		<input type="hidden" name="checkin" value={ci} />
		<button
			type="button"
			aria-label={m.searchbar_checkin()}
			onclick={() => (pickerOpen = true)}
			class={large
				? 'h-11 min-w-0 w-full bg-stone-100 px-3 text-left text-sm text-stone-800'
				: 'rounded-md border border-stone-300 bg-white px-2 py-1.5 text-left text-sm text-stone-800'}
		>📅 {ci ? formatDate(ci) : m.bath_select_date()}</button>
	</div>
	<label class="flex min-w-0 flex-col gap-1 text-xs text-stone-500">
		{m.searchbar_nights()}
		<select name="nights" bind:value={n} class={large ? 'h-11 w-full rounded-none border-0 bg-stone-100 px-3 text-sm text-stone-800' : 'rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm'}>
			{#each nightOptions as v}
				<option value={v}>{m.searchbar_nights_option({ n: String(v) })}</option>
			{/each}
		</select>
	</label>
	<label class="flex min-w-0 flex-col gap-1 text-xs text-stone-500">
		{m.searchbar_adults()}
		<select name="adults" bind:value={a} class={large ? 'h-11 w-full rounded-none border-0 bg-stone-100 px-3 text-sm text-stone-800' : 'rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm'}>
			{#each [1, 2, 3, 4] as v}
				<option value={v}>{m.searchbar_adults_option({ n: String(v) })}</option>
			{/each}
		</select>
	</label>
	<button
		type="submit"
		class={large
			? 'col-span-2 h-11 bg-brand-900 px-6 text-sm font-semibold text-white transition hover:bg-brand-700 sm:col-span-1'
			: 'rounded-md bg-brand-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700'}
	>
		{m.searchbar_submit()}
	</button>
</form>

<ScrollDatePicker bind:open={pickerOpen} checkin={ci} nights={n} minDate={minDate} maxDate={maxDate} onSelect={(date, nights) => { ci = date; n = nights; }} />
