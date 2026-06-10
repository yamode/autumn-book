<script lang="ts">
	import type { Faq } from '$lib/types';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import * as m from '$lib/paraglide/messages';

	let { faqs, heading = '' }: { faqs: Faq[]; heading?: string } = $props();
</script>

{#if faqs.length > 0}
	<section>
		<h2 class="font-display mb-4 text-2xl" style="color: var(--fac-heading, #1f1d15)">{heading || m.facility_faq()}</h2>
		<div class="space-y-2">
			{#each faqs as q}
				<details class="rounded-lg border border-stone-200 bg-white px-4 py-3">
					<summary class="cursor-pointer text-sm font-medium">
						<span class="mr-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">{q.category}</span>
						{q.question}
					</summary>
					<div class="mt-2 text-sm text-stone-600"><MarkdownView source={q.answer} /></div>
				</details>
			{/each}
		</div>
	</section>
{/if}
