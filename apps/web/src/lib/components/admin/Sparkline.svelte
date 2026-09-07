<script lang="ts">
	// 依存を足さないための素の SVG スパークライン。
	let {
		values,
		width = 120,
		height = 32
	}: { values: number[]; width?: number; height?: number } = $props();

	let points = $derived.by(() => {
		if (values.length === 0) return '';
		const max = Math.max(...values, 1);
		const step = values.length > 1 ? width / (values.length - 1) : width;
		return values.map((v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * height).toFixed(1)}`).join(' ');
	});
</script>

{#if points}
	<svg viewBox="0 0 {width} {height}" class="h-8 w-full" preserveAspectRatio="none" aria-hidden="true">
		<polyline {points} fill="none" stroke="currentColor" stroke-width="1.5" class="text-brand-700" />
	</svg>
{:else}
	<div class="h-8"></div>
{/if}
