<script lang="ts">
	// プライベートブック（特別会員・docs/private-book.md）の帯:「○○ 様のプライベートブック　特別料金でご案内しています ｜ ふつうのご予約に戻る」。
	// 公式サイトの中で状態のとき全画面のヘッダーの下に出す（(public)/+layout.svelte）。専用ページ経由の予約の予約入力（/booking/hold）・完了の画面でも出す。
	// 名前が取れないときは「プライベートブック」だけ。公式の一般の予約では出さない（呼び出し側が状態・memberPage のときだけ使う）。
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
		currentPartnerId = null
	}: {
		name?: string | null;
		releaseHoldId?: string | null;
		pages?: { partnerId: string; name: string }[];
		currentPartnerId?: string | null;
	} = $props();
	const label = $derived(name ? m.private_book_band_named({ name }) : m.private_book_band_unnamed());
	const here = $derived(page.url.pathname + page.url.search);
	const others = $derived(pages.filter((p) => p.partnerId !== currentPartnerId));
	const linkClass = 'underline decoration-stone-300 underline-offset-4 hover:text-brand-800';
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-500">
	<span class="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-brand-900/5 px-2.5 py-0.5 font-medium text-brand-900">
		<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-900"></span>
		{label}
	</span>
	<span>{m.private_book_band_note()}</span>
	{#if !releaseHoldId && others.length}
		<!-- 本人とご家族のご招待のページがあるとき: 別のページに切り替える（入口が使えるかを確かめ直す） -->
		<span class="flex flex-wrap items-center gap-x-2">
			{#each others as p (p.partnerId)}
				<a href="{PB_ENTRY_PATH}?page={encodeURIComponent(p.partnerId)}&back={encodeURIComponent(here)}" data-sveltekit-reload class={linkClass}>
					{m.private_book_band_switch({ name: p.name })}
				</a>
			{/each}
		</span>
	{/if}
	<form method="POST" action={PB_EXIT_PATH} class="ml-auto" data-sveltekit-reload>
		{#if releaseHoldId}<input type="hidden" name="holdId" value={releaseHoldId} />{/if}
		<input type="hidden" name="back" value={releaseHoldId ? '/' : here} />
		<button type="submit" class={linkClass}>{m.private_book_band_back()}</button>
	</form>
</div>
