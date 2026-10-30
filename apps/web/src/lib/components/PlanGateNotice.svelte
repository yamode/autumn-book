<script lang="ts">
	// 会員限定のシークレットプランを、予約できない閲覧者が開いたときの案内（料金・予約ボタンの代わりに出す）
	import * as m from '$lib/paraglide/messages';
	import type { PlanAccess, PlanGate } from '$lib/plan-access';
	import { rankName } from '$lib/rank-name';

	let { gate, access, next }: { gate: PlanGate; access?: PlanAccess; next: string } = $props();

	const rank = $derived(access?.minRank && access.minRank !== 'standard' ? rankName(access.minRank) : null);
</script>

<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
	{#if gate === 'rank'}
		<p class="font-medium text-amber-900">{m.plan_gate_rank_title({ rank: rank ?? '' })}</p>
		<p class="mt-1 text-amber-800">{m.plan_gate_rank_body()}</p>
		<a href="/membership" class="mt-3 block rounded-lg border border-brand-800 py-2.5 text-center text-sm font-medium text-brand-900 hover:bg-white">{m.plan_gate_rank_cta()}</a>
	{:else}
		<p class="font-medium text-amber-900">{m.plan_gate_login_title()}</p>
		<p class="mt-1 text-amber-800">{rank ? m.plan_gate_login_rank_body({ rank }) : m.plan_gate_login_body()}</p>
		<a href="/auth/login?next={encodeURIComponent(next)}" class="mt-3 block rounded-lg bg-accent-600 py-2.5 text-center text-sm font-medium text-white hover:bg-accent-500">{m.plan_gate_login_cta()}</a>
	{/if}
</div>
