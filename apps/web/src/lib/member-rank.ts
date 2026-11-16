import type { RankCode } from '$lib/plan-access';
import * as m from '$lib/paraglide/messages';

export const rankNights = { standard: 0, silver: 2, gold: 5, platinum: 10 } as const;

export function rankCondition(rank: RankCode): string {
	return rank === 'standard'
		? m.membership_cond_standard()
		: m.membership_cond_nights({ n: String(rankNights[rank]) });
}
