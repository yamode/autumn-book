import { listRankCancelPolicies } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbListRankCancelPolicies } from '$lib/server/supabase-data';
import type { RankCancelPolicy } from '$lib/types';
import type { PageServerLoad } from './$types';

// 会員プログラム紹介ページ（公開・ログイン不要）。会員なら CTA を出し分ける。
// グレード別キャンセル規定（book.rank_cancel_policies・公開 read）を各グレードに表示する（P3）。
export const load: PageServerLoad = async ({ locals }) => {
	let cancelPolicies: RankCancelPolicy[];
	if (DATA_SOURCE === 'supabase') {
		cancelPolicies = await sbListRankCancelPolicies();
	} else {
		cancelPolicies = listRankCancelPolicies().map((p) => ({
			rankCode: p.rankCode,
			rules: p.rules,
			allowAmendInPenalty: p.allowAmendInPenalty,
			note: p.note
		}));
	}
	return { isMember: locals.user?.role === 'member', cancelPolicies };
};
