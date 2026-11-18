<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { rank, compact = false }: { rank: 'standard' | 'silver' | 'gold' | 'platinum'; compact?: boolean } = $props();

	// スタイルはロケールに依存しないため固定
	const cls = {
		standard: 'bg-stone-100 text-stone-600 border-stone-300',
		silver: 'bg-slate-100 text-slate-600 border-slate-400',
		gold: 'bg-amber-50 text-amber-700 border-amber-400',
		platinum: 'bg-slate-800 text-slate-100 border-slate-700'
	} as const;

	// ラベルはロケール対応メッセージから取得
	let label = $derived(
		rank === 'standard'
			? m.rank_standard()
			: rank === 'silver'
				? m.rank_silver()
				: rank === 'gold'
					? m.rank_gold()
					: m.rank_platinum()
	);
</script>

<span class="inline-flex items-center gap-1 rounded-full border py-0.5 text-xs font-medium {compact ? 'px-2 whitespace-nowrap' : 'px-2.5'} {cls[rank]}">
	◆ {compact ? label : m.rank_member({ rank: label })}
</span>
