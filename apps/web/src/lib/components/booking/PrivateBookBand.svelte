<script lang="ts">
	// 特別会員の専用ページ（プライベートブック）経由の予約で、予約入力（/booking/hold）・完了画面の上に出す帯。
	// B面（/p/<token>）のヘッダー下の帯と同じ言葉・形:「○○ 様のプライベートブック　特別料金でご案内しています ｜ ふつうのご予約に戻る」。
	// 名前が取れないときは「プライベートブック」だけ。公式の一般の予約では出さない（呼び出し側が memberPage のときだけ使う）。
	// releaseHoldId: 予約入力では「ふつうのご予約に戻る」で仮押さえを解放してから公式サイトへ戻る（ただのリンクだと期限まで在庫が減ったまま）
	import * as m from '$lib/paraglide/messages';

	let { name = null, releaseHoldId = null }: { name?: string | null; releaseHoldId?: string | null } = $props();
	const label = $derived(name ? m.private_book_band_named({ name }) : m.private_book_band_unnamed());
	const linkClass = 'underline decoration-stone-300 underline-offset-4 hover:text-brand-800';
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-500">
	<span class="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-brand-900/5 px-2.5 py-0.5 font-medium text-brand-900">
		<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-900"></span>
		{label}
	</span>
	<span>{m.private_book_band_note()}</span>
	{#if releaseHoldId}
		<form method="POST" action="?/release" class="ml-auto">
			<input type="hidden" name="holdId" value={releaseHoldId} />
			<input type="hidden" name="back" value="/" />
			<button type="submit" class={linkClass}>{m.private_book_band_back()}</button>
		</form>
	{:else}
		<a href="/" class="ml-auto {linkClass}">{m.private_book_band_back()}</a>
	{/if}
</div>
