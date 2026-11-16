import type { RankCode } from '$lib/plan-access';
import * as m from '$lib/paraglide/messages';

export const rankVisits = { standard: 0, silver: 5, gold: 10, platinum: 20 } as const;

export function rankCondition(rank: RankCode): string {
	return rank === 'standard'
		? m.membership_cond_standard()
		: m.membership_cond_visits({ n: String(rankVisits[rank]) });
}
