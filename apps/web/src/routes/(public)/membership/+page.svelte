<script lang="ts">
	import MemberBenefitsTable from '$lib/components/MemberBenefitsTable.svelte';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
</script>

<svelte:head><title>{m.membership_title()}</title></svelte:head>

<div class="forum-shell mx-auto max-w-5xl px-4 py-12 sm:py-16">
	<header class="text-center">
		<p class="text-sm font-semibold tracking-[0.2em] text-accent-600">YAMADO MEMBERS</p>
		<h1 class="mt-2 text-3xl sm:text-4xl">{m.membership_heading()}</h1>
		<p class="mx-auto mt-4 max-w-2xl text-stone-600">{m.membership_lead()}</p>
	</header>

	<section class="mt-10" aria-labelledby="membership-ranks">
		<h2 id="membership-ranks" class="text-center text-2xl">{m.membership_ranks_heading()}</h2>
		<p class="mt-2 text-center text-sm leading-6 text-stone-600">{m.membership_table_hint()}</p>
		<p class="mt-3 text-right text-xs text-stone-600 md:hidden">{m.membership_scroll_hint()} <span aria-hidden="true">→</span></p>
		<MemberBenefitsTable />

		<div class="mt-7 text-center">
			{#if !data.isMember}
				<a href="/auth/register" class="inline-block whitespace-nowrap rounded-lg bg-accent-600 px-8 py-3 font-semibold text-white hover:bg-accent-500">{m.membership_cta_join()}</a>
			{:else}
				<a href="/account/points" class="inline-block rounded-lg border border-brand-800 px-6 py-3 font-semibold text-brand-800 hover:bg-brand-50">{m.membership_my_points()}</a>
			{/if}
		</div>
	</section>
</div>
