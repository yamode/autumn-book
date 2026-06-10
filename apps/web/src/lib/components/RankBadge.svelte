<script lang="ts">
	let { rank }: { rank: 'standard' | 'silver' | 'gold' } = $props();

	const styles = {
		standard: { label: 'スタンダード', cls: 'bg-stone-100 text-stone-600 border-stone-300' },
		silver: { label: 'シルバー', cls: 'bg-slate-100 text-slate-600 border-slate-400' },
		gold: { label: 'ゴールド', cls: 'bg-amber-50 text-amber-700 border-amber-400' }
	} as const;
</script>

<span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium {styles[rank].cls}">
	◆ {styles[rank].label}会員
</span>
