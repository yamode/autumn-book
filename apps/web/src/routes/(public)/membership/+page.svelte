<script lang="ts">
	import RankBadge from '$lib/components/RankBadge.svelte';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();

	// 会員グレード（ビジネスルール・表示用の静的定義）
	const ranks = [
		{ code: 'standard' as const, cond: m.membership_cond_standard(), rate: 1 },
		{ code: 'silver' as const, cond: m.membership_cond_silver(), rate: 2 },
		{ code: 'gold' as const, cond: m.membership_cond_gold(), rate: 3 },
		{ code: 'platinum' as const, cond: m.membership_cond_platinum(), rate: 5 }
	];

	const benefits = [
		{ icon: '◆', title: m.membership_benefit_points_t(), body: m.membership_benefit_points_b() },
		{ icon: '⏱', title: m.membership_benefit_advance_t(), body: m.membership_benefit_advance_b() },
		{ icon: '✦', title: m.membership_benefit_plans_t(), body: m.membership_benefit_plans_b() },
		{ icon: '❄', title: m.membership_benefit_personalize_t(), body: m.membership_benefit_personalize_b() },
		{ icon: '⇄', title: m.membership_benefit_datechange_t(), body: m.membership_benefit_datechange_b() },
		{ icon: '✓', title: m.membership_benefit_cancel_t(), body: m.membership_benefit_cancel_b() },
		{ icon: '♥', title: m.membership_benefit_favorites_t(), body: m.membership_benefit_favorites_b() },
		{ icon: '✉', title: m.membership_benefit_otayori_t(), body: m.membership_benefit_otayori_b() },
		{ icon: '💬', title: m.membership_benefit_community_t(), body: m.membership_benefit_community_b() }
	];
</script>

<svelte:head><title>{m.membership_title()}</title></svelte:head>

<div class="forum-shell mx-auto max-w-4xl px-4 py-12 sm:py-16">
	<!-- ヒーロー -->
	<header class="text-center">
		<p class="text-sm font-semibold tracking-[0.2em] text-accent-600">YAMADO MEMBERS</p>
		<h1 class="mt-2 text-3xl sm:text-4xl">{m.membership_heading()}</h1>
		<p class="mx-auto mt-4 max-w-2xl text-stone-600">{m.membership_lead()}</p>
		{#if !data.isMember}
			<div class="mt-6 flex flex-wrap items-center justify-center gap-3">
				<a href="/auth/register" class="rounded-lg bg-accent-600 px-6 py-3 font-semibold text-white hover:bg-accent-500">{m.membership_cta_join()}</a>
				<span class="text-sm text-stone-500">{m.membership_free()}</span>
			</div>
		{/if}
	</header>

	<!-- ポイントの仕組み -->
	<section class="mt-14 rounded-2xl border border-stone-200 bg-white p-6 sm:p-8">
		<h2 class="text-xl">{m.membership_how_heading()}</h2>
		<p class="mt-3 text-stone-600">{m.membership_how_body()}</p>
	</section>

	<!-- グレードと還元率 -->
	<section class="mt-10">
		<h2 class="text-xl">{m.membership_ranks_heading()}</h2>
		<p class="mt-1 text-sm text-stone-500">{m.membership_rank_note()}</p>
		<div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{#each ranks as r}
				<div class="rounded-2xl border border-stone-200 bg-white p-6 text-center">
					<div class="flex justify-center"><RankBadge rank={r.code} /></div>
					<p class="mt-4 text-4xl font-bold text-brand-900">{r.rate}<span class="text-lg font-semibold">%</span></p>
					<p class="text-sm text-stone-500">{m.membership_rate_label()}</p>
					<p class="mt-3 border-t border-stone-100 pt-3 text-sm text-stone-600">{r.cond}</p>
				</div>
			{/each}
		</div>
	</section>

	<!-- 会員特典 -->
	<section class="mt-12">
		<h2 class="text-xl">{m.membership_benefits_heading()}</h2>
		<div class="mt-5 grid gap-4 sm:grid-cols-2">
			{#each benefits as b}
				<div class="flex gap-4 rounded-2xl border border-stone-200 bg-white p-5">
					<span class="text-2xl text-accent-600">{b.icon}</span>
					<div>
						<h3 class="text-base">{b.title}</h3>
						<p class="mt-1 text-sm text-stone-600">{b.body}</p>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- 末尾CTA -->
	{#if !data.isMember}
		<div class="mt-14 rounded-2xl bg-brand-900 p-8 text-center text-stone-100">
			<h2 class="text-2xl text-white">{m.membership_cta2_heading()}</h2>
			<p class="mx-auto mt-2 max-w-xl text-sm text-stone-300">{m.membership_cta2_body()}</p>
			<a href="/auth/register" class="mt-5 inline-block rounded-lg bg-accent-600 px-8 py-3 font-semibold text-white hover:bg-accent-500">{m.membership_cta_join()}</a>
		</div>
	{:else}
		<div class="mt-14 text-center">
			<a href="/account/points" class="inline-block rounded-lg border border-brand-800 px-6 py-3 font-semibold text-brand-800 hover:bg-brand-50">{m.membership_my_points()}</a>
		</div>
	{/if}
</div>
