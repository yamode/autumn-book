<script lang="ts">
	let { steps, current }: { steps: string[]; current: number } = $props();
</script>

<ol class="flex items-center justify-center gap-1 text-xs sm:gap-2 sm:text-sm">
	{#each steps as step, i}
		<li class="flex items-center gap-1 sm:gap-2">
			<span
				class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold {i < current
					? 'bg-emerald-600 text-white'
					: i === current
						? 'bg-brand-800 text-white'
						: 'bg-stone-200 text-stone-500'}"
			>
				{i < current ? '✓' : i + 1}
			</span>
			<span class={i === current ? 'font-medium text-brand-900' : 'text-stone-400'}>{step}</span>
			{#if i < steps.length - 1}
				<span class="text-stone-300">―</span>
			{/if}
		</li>
	{/each}
</ol>
