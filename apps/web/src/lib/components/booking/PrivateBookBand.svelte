<script lang="ts">
	// プライベートブックの帯。プラン一覧では対象会員にオン・オフの両方を表示する。
	// 公式サイトの中で状態のとき全画面のヘッダーの下に出す（(public)/+layout.svelte）。専用ページ経由の予約の予約入力（/booking/hold）・完了の画面でも出す。
	// 名前が取れないときは「プライベートブック」だけ。
	// 「ふつうのご予約に戻る」は出口 POST /private-book/off（クッキーを消して back へ）。
	// releaseHoldId: 予約入力では仮押さえを解放してから戻る（ただのリンクだと期限まで在庫が減ったまま）。戻り先は公式サイトのトップ。
	// pages: 切り替えられるページが 2 つ以上なら（本人とご家族のご招待）、帯から切り替えられるようにする
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { PB_ENTRY_PATH, PB_EXIT_PATH } from '$lib/private-book';

	let {
		name = null,
		releaseHoldId = null,
		pages = [],
		currentPartnerId = null,
		showToggle = false,
		active = true
	}: {
		name?: string | null;
		releaseHoldId?: string | null;
		pages?: { partnerId: string; name: string }[];
		currentPartnerId?: string | null;
		showToggle?: boolean;
		active?: boolean;
	} = $props();
	const label = $derived(name ? m.private_book_band_named({ name }) : m.private_book_band_unnamed());
	const here = $derived(page.url.pathname + page.url.search);
	const others = $derived(pages.filter((p) => p.partnerId !== currentPartnerId));
	const linkClass = 'underline decoration-stone-300 underline-offset-4 hover:text-brand-800';
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 text-xs text-stone-500 {showToggle && active ? 'border-brand-900/20 bg-brand-900/5' : 'border-stone-200 bg-white'} {showToggle ? 'py-1' : 'py-2'}">
	<span class={showToggle ? 'min-w-0 flex-1 break-words text-sm font-medium text-brand-900' : 'inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-brand-900/5 px-2.5 py-0.5 font-medium text-brand-900'}>
		{#if !showToggle}<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-900"></span>{/if}
		{label}
	</span>
	{#if !showToggle}<span>{m.private_book_band_note()}</span>{/if}
	{#if !releaseHoldId && others.length}
		<!-- 本人とご家族のご招待のページがあるとき: 別のページに切り替える（入口が使えるかを確かめ直す） -->
		<span class="flex flex-wrap items-center gap-x-2 {showToggle ? 'order-last basis-full pb-1.5 sm:order-none sm:basis-auto sm:pb-0' : ''}">
			{#each others as p (p.partnerId)}
				<a href="{PB_ENTRY_PATH}?page={encodeURIComponent(p.partnerId)}&back={encodeURIComponent(here)}" data-sveltekit-reload class={linkClass}>
					{m.private_book_band_switch({ name: p.name })}
				</a>
			{/each}
		</span>
	{/if}
	<form method={active ? 'POST' : 'GET'} action={active ? PB_EXIT_PATH : PB_ENTRY_PATH} class="ml-auto shrink-0" data-sveltekit-reload>
		{#if releaseHoldId}<input type="hidden" name="holdId" value={releaseHoldId} />{/if}
		<input type="hidden" name="back" value={releaseHoldId ? '/' : here} />
		{#if showToggle}
			<button
				type="submit"
				role="switch"
				aria-checked={active}
				aria-label={m.private_book_band_unnamed()}
				class="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 font-medium tracking-wide text-brand-900 hover:bg-brand-900/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-800"
			>
				<span aria-hidden="true">{active ? 'ON' : 'OFF'}</span>
				<span aria-hidden="true" class="flex h-6 w-11 items-center rounded-full border p-0.5 {active ? 'justify-end border-brand-900 bg-brand-900' : 'justify-start border-stone-500 bg-stone-500'}">
					<span class="h-4 w-4 rounded-full bg-white shadow-sm"></span>
				</span>
			</button>
		{:else}
			<button type="submit" class={linkClass}>{m.private_book_band_back()}</button>
		{/if}
	</form>
</div>
