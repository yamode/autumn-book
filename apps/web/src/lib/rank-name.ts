// 会員グレード名（閲覧者の言語・messages の rank_*）
import * as m from '$lib/paraglide/messages';
import type { RankCode } from '$lib/plan-access';

export function rankName(code: RankCode): string {
	switch (code) {
		case 'silver':
			return m.rank_silver();
		case 'gold':
			return m.rank_gold();
		case 'platinum':
			return m.rank_platinum();
		default:
			return m.rank_standard();
	}
}
