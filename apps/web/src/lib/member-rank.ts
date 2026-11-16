import type { RankCode } from '$lib/plan-access';
import * as m from '$lib/paraglide/messages';

export const rankTargets = {
	standard: { visits: 0, nights: 0 },
	silver: { visits: 5, nights: 10 },
	gold: { visits: 30, nights: 20 },
	platinum: { visits: 40, nights: 30 }
} as const;

export function rankCondition(rank: RankCode): string {
	return rank === 'standard'
		? m.membership_cond_standard()
		: m.membership_cond_stays({
			visits: String(rankTargets[rank].visits), nights: String(rankTargets[rank].nights)
		});
}
