<script lang="ts">
	// プライベートブックの状態のとき、その施設の料金が特別料金かどうかの一言（プラン一覧・プラン詳細・検索の施設ごと）。
	// view が null（状態でない）なら何も出さない。special=false の施設は「この施設はふつうの料金です」（隠さずにふつうの料金で出す）
	import * as m from '$lib/paraglide/messages';

	let { view, compact = false }: { view: { special: boolean } | null | undefined; compact?: boolean } = $props();
</script>

{#if view}
	<p
		class="{compact ? 'mt-1.5 text-xs' : 'mt-3 rounded-lg px-3 py-2 text-xs'} {view.special
			? compact
				? 'text-brand-900'
				: 'bg-brand-900/5 text-brand-900'
			: compact
				? 'text-stone-500'
				: 'bg-stone-100 text-stone-600'}"
		role="note"
	>
		{view.special ? m.private_book_special_note() : m.private_book_normal_price()}
	</p>
{/if}
