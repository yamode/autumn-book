import { rankMeets, type PlanViewer } from '$lib/plan-access';
import type { OptionCategory } from '$lib/types';

/** 客室の個別アレンジと、会員共通の通常オプションを分ける。 */
export function isStayPersonalization(category: OptionCategory): boolean {
	return category === 'amenity' || category === 'personalize';
}

export const canPersonalizeStay = (viewer: PlanViewer) => rankMeets(viewer, 'platinum');
export const favoriteRoomMinRank = 'silver';
export const canDesignateFavoriteRoom = (viewer: PlanViewer) => rankMeets(viewer, favoriteRoomMinRank);

export function cancellationPolicyRank(rank: string | null | undefined): 'standard' | 'gold' | 'platinum' {
	return rank === 'gold' || rank === 'platinum' ? rank : 'standard';
}
