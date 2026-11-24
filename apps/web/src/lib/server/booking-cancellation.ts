import type { CancellationPolicy } from '@autumn-book/core';
import { cancellationPolicyRank } from '$lib/member-benefits';
import type { MemberPageSnapshot } from '$lib/partner-member-page';
import { viewerOf } from './secret-plans';
import { sbListRankCancelPolicies } from './supabase-data';
import { cachedPublic } from './public-cache';

export async function loadCancellationFallback(locals: App.Locals): Promise<CancellationPolicy> {
	const [viewer, policies] = await Promise.all([
		viewerOf(locals),
		// グレード別の規定は全員同じ公開データ。管理画面の編集画面は直に読むので、ここの公開用だけ短命キャッシュに乗せる
		cachedPublic('rank-cancel-policies', () => sbListRankCancelPolicies())
	]);
	const rank = cancellationPolicyRank(viewer.rank);
	const policy = policies.find((row) => row.rankCode === rank) ?? policies.find((row) => row.rankCode === 'standard');
	if (!policy) throw new Error('Missing default cancellation policy');
	return { rules: policy.rules, note: '' };
}

export function appliedCancellationPolicy(plan: CancellationPolicy, fallback: CancellationPolicy, memberPage?: MemberPageSnapshot | null): CancellationPolicy {
	const base = plan.rules.length ? plan : fallback;
	const pageRules = memberPage?.cancelRules;
	if (!pageRules?.length) return base;
	if (memberPage?.cancelPolicyMode === 'page') return { rules: pageRules, note: '' };
	if (memberPage?.cancelPolicyMode !== 'favorable') return base;

	const baseRules = [...base.rules].sort((a, b) => a.days_before - b.days_before);
	const dedicatedRules = [...pageRules].sort((a, b) => a.days_before - b.days_before);
	const thresholds = new Set([...baseRules, ...dedicatedRules].map((rule) => rule.days_before));
	const rateAt = (rules: CancellationPolicy['rules'], days: number) => rules.find((rule) => days <= rule.days_before)?.rate ?? 0;
	return {
		rules: [...thresholds].map((days) => ({ days_before: days, rate: Math.min(rateAt(baseRules, days), rateAt(dedicatedRules, days)) })),
		note: ''
	};
}
