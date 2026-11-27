<script lang="ts">
	// プライベートブックの帯。プラン一覧・詳細では対象会員にオン・オフの両方を表示する。
	// 公式サイトでの表示範囲は (public)/+layout.svelte で決める。
	// 名前が取れないときは「プライベートブック」だけ。
	// 「ふつうのご予約に戻る」は出口 POST /private-book/off（クッキーを消して back へ）。
	// pages: 切り替えられるページが 2 つ以上なら（本人とご家族のご招待）、帯から切り替えられるようにする
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { PB_ENTRY_PATH, PB_EXIT_PATH } from '$lib/private-book';

	let {
		name = null,
		pages = [],
		currentPartnerId = null,
		toggle,
		active = true
	}: {
		name?: string | null;
		pages?: { partnerId: string; name: string }[];
		currentPartnerId?: string | null;
		toggle?: Snippet;
		active?: boolean;
	} = $props();
	const label = $derived(name ? m.private_book_band_named({ name }) : m.private_book_band_unnamed());
	const here = $derived(page.url.pathname + page.url.search);
	const others = $derived(pages.filter((p) => p.partnerId !== currentPartnerId));
	const linkClass = 'underline decoration-stone-300 underline-offset-4 hover:text-brand-800';
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 text-xs text-stone-500 {toggle && active ? 'border-brand-900/20 bg-brand-900/5' : 'border-stone-200 bg-white'} {toggle ? 'py-1' : 'py-2'}">
	{#if toggle}
		{#if others.length}<span class="hidden font-medium text-brand-900 md:inline">{label}</span>{/if}
	{:else}
		<span class="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-brand-900/5 px-2.5 py-0.5 font-medium text-brand-900">
			<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-900"></span>
			{label}
		</span>
		<span>{m.private_book_band_note()}</span>
	{/if}
	{#if others.length}
		<!-- 本人とご家族のご招待のページがあるとき: 別のページに切り替える（入口が使えるかを確かめ直す） -->
		<span class="flex flex-wrap items-center gap-x-2 {toggle ? 'order-last basis-full pb-1.5 sm:order-none sm:basis-auto sm:pb-0' : ''}">
			{#each others as p (p.partnerId)}
				<a href="{PB_ENTRY_PATH}?page={encodeURIComponent(p.partnerId)}&back={encodeURIComponent(here)}" data-sveltekit-reload class={linkClass}>
					{m.private_book_band_switch({ name: p.name })}
				</a>
			{/each}
		</span>
	{/if}
	{#if toggle}
		{@render toggle()}
	{:else}
		<form method="POST" action={PB_EXIT_PATH} class="ml-auto shrink-0" data-sveltekit-reload>
			<input type="hidden" name="back" value={here} />
			<button type="submit" class={linkClass}>{m.private_book_band_back()}</button>
		</form>
	{/if}
</div>
