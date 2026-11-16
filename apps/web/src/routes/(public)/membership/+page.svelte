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

	const comparisonBenefits = [
		m.membership_benefit_advance_t(),
		m.membership_benefit_plans_t(),
		m.membership_benefit_personalize_t(),
		m.membership_benefit_datechange_t()
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

	// ご予約後の変更・滞在アレンジ（会員特典の詳細）
	const changes = [
		{ n: '01', title: m.membership_change_date_t(), body: m.membership_change_date_b() },
		{ n: '02', title: m.membership_change_guests_t(), body: m.membership_change_guests_b() },
		{ n: '03', title: m.membership_change_room_t(), body: m.membership_change_room_b() },
		{ n: '04', title: m.membership_change_options_t(), body: m.membership_change_options_b() }
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

	<!-- グレードと還元率：共通特典を同じ順序で並べて比較する -->
	<section class="mt-12" aria-labelledby="membership-ranks">
		<div class="text-center">
			<h2 id="membership-ranks" class="text-2xl">{m.membership_ranks_heading()}</h2>
			<p class="mt-3 text-sm leading-6 text-stone-500">{m.membership_rank_note()}</p>
		</div>
		<div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{#each ranks as r}
				{@const premium = r.code === 'platinum'}
				<article class="rank-plan relative flex flex-col overflow-hidden rounded-2xl border {premium ? 'border-brand-900 bg-brand-900 text-white shadow-lg' : 'border-stone-200 bg-white text-brand-900'}">
					<div class="h-1 {premium ? 'bg-accent-500' : r.code === 'gold' ? 'bg-amber-400' : r.code === 'silver' ? 'bg-slate-400' : 'bg-stone-300'}"></div>
					<div class="flex flex-1 flex-col px-5 pb-6 pt-7">
						<div class="flex justify-center"><RankBadge rank={r.code} /></div>
						<div class="py-7 text-center">
							<p class="text-sm {premium ? 'text-stone-300' : 'text-stone-500'}">{m.membership_rate_label()}</p>
							<p class="mt-2 font-sans text-6xl font-semibold tracking-tight">{r.rate}<span class="ml-1 text-2xl">%</span></p>
						</div>
						<p class="flex min-h-16 items-center justify-center rounded-lg px-2 py-3 text-center text-sm font-medium leading-6 {premium ? 'bg-white/10 text-white' : 'bg-stone-50 text-stone-700'}">{r.cond}</p>
						<ul class="mt-6 flex-1 space-y-4 border-t pt-6 {premium ? 'border-white/15' : 'border-stone-100'}">
							{#each comparisonBenefits as benefit}
								<li class="flex items-start gap-2 text-sm leading-6">
									<span aria-hidden="true" class="shrink-0 {premium ? 'text-accent-300' : 'text-accent-600'}">✓</span>
									<span class={premium ? 'text-stone-100' : 'text-stone-600'}>{benefit}</span>
								</li>
							{/each}
						</ul>
					</div>
				</article>
			{/each}
		</div>
		<div class="mt-6 text-center">
			{#if !data.isMember}
				<a href="/auth/register" class="inline-block rounded-lg bg-accent-600 px-8 py-3 font-semibold text-white hover:bg-accent-500">{m.membership_cta_join()}</a>
			{:else}
				<a href="/account/points" class="inline-block rounded-lg border border-brand-800 px-6 py-3 font-semibold text-brand-800 hover:bg-brand-50">{m.membership_my_points()}</a>
			{/if}
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

	<!-- ご予約後の変更・滞在アレンジ（日程変更特典の詳細） -->
	<section class="mt-12 rounded-2xl border border-stone-200 bg-white p-6 sm:p-8">
		<h2 class="text-xl">{m.membership_change_heading()}</h2>
		<p class="mt-2 text-stone-600">{m.membership_change_lead()}</p>
		<div class="mt-6 grid gap-6 sm:grid-cols-2">
			{#each changes as c}
				<div class="flex gap-4">
					<span class="font-display text-2xl leading-none text-accent-500">{c.n}</span>
					<div>
						<h3 class="text-base">{c.title}</h3>
						<p class="mt-1 text-sm text-stone-600">{c.body}</p>
					</div>
				</div>
			{/each}
		</div>
		<p class="mt-6 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800">{m.membership_change_note()}</p>
	</section>

	<!-- 末尾CTA -->
	{#if !data.isMember}
		<div class="mt-14 rounded-2xl bg-brand-900 p-8 text-center text-stone-100">
			<!-- .forum-shell の見出し色（app.css・レイヤー外）が text-white に勝つため important で白に固定 -->
			<h2 class="text-2xl text-white!">{m.membership_cta2_heading()}</h2>
			<p class="mx-auto mt-2 max-w-xl text-sm text-stone-300">{m.membership_cta2_body()}</p>
			<a href="/auth/register" class="mt-5 inline-block rounded-lg bg-accent-600 px-8 py-3 font-semibold text-white hover:bg-accent-500">{m.membership_cta_join()}</a>
		</div>
	{:else}
		<div class="mt-14 text-center">
			<a href="/account/points" class="inline-block rounded-lg border border-brand-800 px-6 py-3 font-semibold text-brand-800 hover:bg-brand-50">{m.membership_my_points()}</a>
		</div>
	{/if}
</div>
