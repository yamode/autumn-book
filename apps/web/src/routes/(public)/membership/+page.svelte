<script lang="ts">
	import { tick } from 'svelte';
	import { RANK_CODES, type RankCode } from '$lib/plan-access';
	import { rankName } from '$lib/rank-name';
	import { rankCondition } from '$lib/member-rank';
	import { favoriteRoomMinRank } from '$lib/member-benefits';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();

	const rates = [1, 2, 3, 5];

	type Detail = { title: string; body: string; sections?: { title: string; body: string }[] };
	type Perk = Detail & { key: string; minRank: RankCode };

	const points: Detail = { title: m.membership_rate_label(), body: m.membership_how_body() };
	const qualification: Detail = {
		title: m.membership_condition_label(),
		body: m.membership_rank_note(),
		sections: [{ title: m.membership_rank_grace_title(), body: m.membership_rank_grace() }]
	};
	const perks: Perk[] = [
		{ key: 'advance', minRank: 'silver', title: m.membership_benefit_advance_t(), body: m.membership_advance_silver_body() },
		{ key: 'room', minRank: favoriteRoomMinRank, title: m.membership_room_designation(), body: m.membership_room_designation_body() },
		{ key: 'cancellation', minRank: 'gold', title: m.membership_benefit_cancel_t(), body: m.membership_benefit_cancel_b() },
		{ key: 'personalize', minRank: 'platinum', title: m.membership_benefit_personalize_t(), body: m.membership_personalize_platinum_body() },
		{ key: 'plans', minRank: 'standard', title: m.membership_benefit_plans_t(), body: m.membership_benefit_plans_b() },
		{
			key: 'changes', minRank: 'standard', title: m.membership_basic_changes(), body: m.membership_basic_changes_body(),
			sections: [
				{ title: m.membership_change_date_t(), body: m.membership_change_date_b() },
				{ title: m.membership_change_guests_t(), body: m.membership_change_guests_b() },
				{ title: m.membership_change_room_t(), body: m.membership_change_room_b() },
				{ title: m.membership_change_options_t(), body: m.membership_change_options_b() }
			]
		},
		{ key: 'community', minRank: 'standard', title: m.membership_benefit_community_t(), body: m.membership_benefit_community_b() },
		{ key: 'otayori', minRank: 'standard', title: m.membership_benefit_otayori_t(), body: m.membership_benefit_otayori_b() }
	];

	let detail = $state<Detail | null>(null);
	let dialog: HTMLDialogElement | undefined = $state();

	$effect(() => {
		const element = dialog;
		if (!element) return;
		function closeOutside(event: MouseEvent) {
			if (event.target !== element) return;
			const bounds = element!.getBoundingClientRect();
			if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) element!.close();
		}
		element.addEventListener('click', closeOutside);
		return () => element.removeEventListener('click', closeOutside);
	});
	async function openDetail(item: Detail) {
		detail = item;
		await tick();
		if (dialog && !dialog.open) dialog.showModal();
	}
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
		<div class="comparison-frame mt-2 overflow-x-auto rounded-2xl border border-stone-200 bg-white md:mt-6">
			<table class="grade-table w-full table-fixed text-sm">
				<colgroup>
					<col class="feature-col" />
					{#each RANK_CODES as rank (rank)}<col class="tier-col tier-{rank}" />{/each}
				</colgroup>
				<thead>
					<tr>
						<th scope="col" class="row-head text-left font-medium">{m.membership_benefits_heading()}</th>
						{#each RANK_CODES as rank (rank)}
							<th scope="col" class="tier-head tier-{rank}">
								<span class="rank-mark" aria-hidden="true"></span>
								<span>{rankName(rank)}</span>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					<tr>
						<th scope="row" class="row-head">
							<button type="button" class="detail-link" onclick={() => openDetail(points)} aria-haspopup="dialog">
								{points.title}
							</button>
						</th>
						{#each rates as rate (rate)}
							<td><span class="rate">{rate}<span class="rate-unit">%</span></span></td>
						{/each}
					</tr>
					<tr>
						<th scope="row" class="row-head">
							<button type="button" class="detail-link" onclick={() => openDetail(qualification)} aria-haspopup="dialog">
								{qualification.title}
							</button>
						</th>
						{#each RANK_CODES as rank (rank)}<td class="condition">{rankCondition(rank)}</td>{/each}
					</tr>
					{#each [...perks].sort((a, b) => RANK_CODES.indexOf(a.minRank) - RANK_CODES.indexOf(b.minRank)) as perk (perk.key)}
						<tr>
							<th scope="row" class="row-head">
								<button type="button" class="detail-link" onclick={() => openDetail(perk)} aria-haspopup="dialog">
									{perk.title}
								</button>
							</th>
							{#each RANK_CODES as rank, index (rank)}
								<td>
									{#if index >= RANK_CODES.indexOf(perk.minRank)}
										<span class="benefit-check" aria-hidden="true">✓</span><span class="sr-only">{m.membership_included()}</span>
									{:else}
										<span class="benefit-dash" aria-hidden="true">—</span><span class="sr-only">{m.membership_not_included()}</span>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mt-7 text-center">
			{#if !data.isMember}
				<a href="/auth/register" class="inline-block whitespace-nowrap rounded-lg bg-accent-600 px-8 py-3 font-semibold text-white hover:bg-accent-500">{m.membership_cta_join()}</a>
			{:else}
				<a href="/account/points" class="inline-block rounded-lg border border-brand-800 px-6 py-3 font-semibold text-brand-800 hover:bg-brand-50">{m.membership_my_points()}</a>
			{/if}
		</div>
	</section>
</div>

<dialog bind:this={dialog} aria-labelledby="membership-detail-title" class="perk-dialog">
	{#if detail}
		<div class="flex items-start justify-between gap-3">
			<h2 id="membership-detail-title" class="text-xl font-semibold text-brand-900">{detail.title}</h2>
			<form method="dialog">
				<button type="submit" class="grid h-10 w-10 place-items-center rounded-full border border-stone-200 text-xl text-stone-700 hover:bg-stone-100" aria-label={m.membership_detail_close()}>×</button>
			</form>
		</div>
		<p class="mt-4 text-sm leading-7 text-stone-700">{detail.body}</p>
		{#each detail.sections ?? [] as section (section.title)}
			<section class="mt-4 rounded-xl bg-stone-50 p-4">
				<h3 class="text-sm font-semibold text-brand-900">{section.title}</h3>
				<p class="mt-1 text-sm leading-7 text-stone-700">{section.body}</p>
			</section>
		{/each}
	{/if}
</dialog>

<style>
	.comparison-frame {
		contain: inline-size paint;
		box-shadow: 0 16px 38px -28px #514a38a6;
	}
	.grade-table {
		min-width: 36rem;
		border-collapse: separate;
		border-spacing: 0;
		color: #302d27;
	}
	.feature-col { width: 29%; }
	.tier-col { width: 17.75%; }
	.tier-standard { --metal: #ab9b86; --light: #faf8f4; }
	.tier-silver { --metal: #8294a6; --light: #f1f5f8; }
	.tier-gold { --metal: #ae8742; --light: #fcf6e7; }
	.tier-platinum { --metal: #8d92a8; --light: #f4f4f9; }
	.tier-head {
		border-top: 3px solid var(--metal);
		padding: 1rem .25rem .75rem;
		background: linear-gradient(145deg, #fff 0%, var(--light) 53%, #fff 100%);
		font-weight: 650;
		overflow-wrap: anywhere;
	}
	.rank-mark {
		display: block;
		width: 1.05rem;
		height: 1.05rem;
		margin: 0 auto .65rem;
		clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
		background: conic-gradient(from 45deg, var(--metal), #fff, var(--metal), var(--light), var(--metal));
	}
	th, td { border-bottom: 1px solid #eae7e1; }
	tbody tr:last-child > * { border-bottom: 0; }
	td { padding: .54rem .36rem; text-align: center; }
	td:nth-child(5) { background: #f8f8fc; }
	.row-head {
		position: sticky;
		left: 0;
		z-index: 1;
		background: #fffdf9;
		box-shadow: 1px 0 #eae7e1;
		padding: .32rem .65rem;
		text-align: left;
	}
	.detail-link {
		display: flex;
		width: 100%;
		min-height: 2.3rem;
		align-items: center;
		border-radius: .35rem;
		cursor: pointer;
		text-align: left;
		font-weight: 550;
	}
	.detail-link:hover { color: #775b2f; text-decoration: underline; }
	.detail-link:focus-visible { outline: 2px solid #78603b; outline-offset: 2px; }
	.rate { font-size: 1.9rem; font-weight: 650; font-variant-numeric: tabular-nums; }
	.rate-unit { margin-inline-start: .07em; font-size: .55em; }
	.condition { color: #5b554c; font-size: .75rem; }
	.benefit-check {
		display: inline-grid;
		width: 1.3rem;
		height: 1.3rem;
		place-items: center;
		border-radius: 100%;
		background: #f2eee6;
		color: #6c542d;
		font-weight: 700;
	}
	td:last-child .benefit-check { background: #e9e9f2; color: #4d5670; }
	.benefit-dash { color: #817c74; }
	.perk-dialog {
		position: fixed;
		width: min(32rem, calc(100% - 2rem));
		max-height: calc(100dvh - 2rem);
		margin: auto;
		padding: clamp(1rem, 4vw, 1.6rem);
		overflow-y: auto;
		border: 1px solid #e7dfcf;
		border-radius: 1rem;
		background: #fffefa;
		box-shadow: 0 20px 70px #211a1240;
	}
	.perk-dialog::backdrop { background: #211a1266; }
</style>
