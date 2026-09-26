<script lang="ts">
	import { todayStr, addDays } from '$lib/format';
	import { MAX_CHILDREN } from './guests';
	import * as m from '$lib/paraglide/messages';

	let {
		checkin = '',
		nights = 1,
		adults = 2,
		childCount = 0,
		action = '/search',
		large = false
	}: { checkin?: string; nights?: number; adults?: number; childCount?: number; action?: string; large?: boolean } = $props();

	// 検索フォームの初期値を props から取り込み、以降はユーザー入力でローカル編集する（意図的な初期化）
	// svelte-ignore state_referenced_locally
	let ci = $state(checkin);
	// svelte-ignore state_referenced_locally
	let n = $state(nights);
	// svelte-ignore state_referenced_locally
	let a = $state(adults);
	// svelte-ignore state_referenced_locally
	let c = $state(childCount);
	const minDate = todayStr();
	const maxDate = addDays(todayStr(), 365);
	// 泊数は最大7泊（一週間の滞在まで）。子どもは 0〜4名（0 は URL に載せない＝従来の大人のみ URL と同じ）
	const nightOptions = [1, 2, 3, 4, 5, 6, 7];
	const childOptions = Array.from({ length: MAX_CHILDREN + 1 }, (_, i) => i);
</script>

<form
	method="GET"
	{action}
	class="flex flex-wrap items-end gap-2 {large ? 'rounded-xl bg-white/95 p-4 shadow-lg' : ''}"
>
	<label class="flex flex-col gap-1 text-xs text-stone-500">
		{m.searchbar_checkin()}
		<input
			type="date"
			name="checkin"
			bind:value={ci}
			min={minDate}
			max={maxDate}
			class="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-800"
		/>
	</label>
	<label class="flex flex-col gap-1 text-xs text-stone-500">
		{m.searchbar_nights()}
		<select name="nights" bind:value={n} class="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm">
			{#each nightOptions as v}
				<option value={v}>{m.searchbar_nights_option({ n: String(v) })}</option>
			{/each}
		</select>
	</label>
	<label class="flex flex-col gap-1 text-xs text-stone-500">
		{m.searchbar_adults()}
		<select name="adults" bind:value={a} class="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm">
			{#each [1, 2, 3, 4] as v}
				<option value={v}>{m.searchbar_adults_option({ n: String(v) })}</option>
			{/each}
		</select>
	</label>
	<label class="flex flex-col gap-1 text-xs text-stone-500">
		{m.searchbar_children()}
		<!-- 0名のときは name を外して children= を送らない（URL を従来どおりに保つ） -->
		<select name={c > 0 ? 'children' : undefined} bind:value={c} class="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm">
			{#each childOptions as v}
				<option value={v}>{v === 0 ? m.searchbar_children_none() : m.searchbar_children_option({ n: String(v) })}</option>
			{/each}
		</select>
	</label>
	<button
		type="submit"
		class="rounded-md bg-brand-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 {large
			? 'px-6 py-2'
			: ''}"
	>
		{m.searchbar_submit()}
	</button>
</form>
