import { rankMeets, type PlanViewer } from '$lib/plan-access';
import type { OptionCategory } from '$lib/types';

/** 客室の個別アレンジと、会員共通の通常オプションを分ける。 */
export function isStayPersonalization(category: OptionCategory): boolean {
	return category === 'amenity' || category === 'personalize';
}

export const stayPersonalizationMinRank = 'silver';
export const canPersonalizeStay = (viewer: PlanViewer) => rankMeets(viewer, stayPersonalizationMinRank);
export const favoriteRoomMinRank = 'silver';
export const canUseFavoriteRooms = (viewer: PlanViewer) => rankMeets(viewer, favoriteRoomMinRank);
export const limitedSaleMinRank = 'silver';
/** コミュニティへの書き込み（スレッド作成・返信）。閲覧は誰でもできる（DB の forum_create_* も同じ条件・2026-11-23） */
export const forumWriteMinRank = 'silver';
export const canWriteForum = (viewer: PlanViewer) => rankMeets(viewer, forumWriteMinRank);

export function cancellationPolicyRank(rank: string | null | undefined): 'standard' | 'gold' | 'platinum' {
	return rank === 'gold' || rank === 'platinum' ? rank : 'standard';
}
