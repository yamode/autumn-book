import { RANK_CODES, type RankCode } from '$lib/plan-access';
import * as m from '$lib/paraglide/messages';

export const memberDisplayRanks = RANK_CODES.filter((rank) => rank !== 'platinum');
export type MemberDisplayRank = (typeof memberDisplayRanks)[number];

export function memberDisplayRank(rank: RankCode): MemberDisplayRank {
	return rank === 'platinum' ? 'gold' : rank;
}

export const rankTargets = {
	standard: { visits: 0, nights: null },
	// シルバーは通算5回以上（2026-11-23 に3回から変更・DB の book._member_lifetime_qualified_rank と同じ）
	silver: { visits: 5, nights: null },
	gold: { visits: 30, nights: 20 },
	platinum: { visits: 40, nights: 30 }
} as const;

export function rankCondition(rank: RankCode): string {
	if (rank === 'standard') return m.membership_cond_standard();
	const { visits, nights } = rankTargets[rank];
	return nights === null
		? m.membership_cond_visits({ visits: String(visits) })
		: m.membership_cond_stays({ visits: String(visits), nights: String(nights) });
}
