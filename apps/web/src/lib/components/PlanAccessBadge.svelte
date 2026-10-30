<script lang="ts">
	// シークレットプランの印（会員限定・グレード以上・限定公開）。普通のプランは何も出さない
	import * as m from '$lib/paraglide/messages';
	import { isOpenPlan, type PlanAccess } from '$lib/plan-access';
	import { rankName } from '$lib/rank-name';

	let { access, size = 'md' }: { access?: PlanAccess; size?: 'sm' | 'md' } = $props();

	const label = $derived.by(() => {
		if (!access || isOpenPlan(access)) return null;
		if (access.audience === 'members') {
			return access.minRank && access.minRank !== 'standard' ? m.plan_badge_rank({ rank: rankName(access.minRank) }) : m.plan_badge_members();
		}
		return m.plan_badge_link();
	});
</script>

{#if label}
	<span class="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 font-bold tracking-wide text-amber-800 {size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'}">
		<span aria-hidden="true">◆</span>{label}
	</span>
{/if}
