import { rankMeets, type PlanViewer } from '$lib/plan-access';
import type { OptionCategory } from '$lib/types';

/** 客室の個別アレンジと、会員共通の通常オプションを分ける。 */
export function isStayPersonalization(category: OptionCategory): boolean {
	return category === 'amenity' || category === 'personalize' || category === 'fridge';
}

/** 冷蔵庫のカスタマイズ・アメニティ: ブロンズ（standard）以上＝会員なら誰でも（2026-11-23） */
export const stayPersonalizationMinRank = 'standard';

/** オプションのランク設定で選べるランク（特別会員＝platinum はゴールドとして扱う） */
export const OPTION_RANKS = ['standard', 'silver', 'gold'] as const;

/** その会員がこのオプションを使えるか（管理画面の「使える会員ランク」・DB の book._option_rank_allowed と同じ） */
export function optionAllowedFor(item: { allowedRanks?: readonly string[] }, viewer: PlanViewer): boolean {
	if (!viewer.isMember) return false;
	const rank = viewer.rank === 'platinum' ? 'gold' : (viewer.rank ?? 'standard');
	return (item.allowedRanks ?? OPTION_RANKS).includes(rank);
}
export const canPersonalizeStay = (viewer: PlanViewer) => rankMeets(viewer, stayPersonalizationMinRank);
export const favoriteRoomMinRank = 'silver';
export const canUseFavoriteRooms = (viewer: PlanViewer) => rankMeets(viewer, favoriteRoomMinRank);
export const limitedSaleMinRank = 'silver';
/** コミュニティへの書き込み（スレッド作成・返信）。閲覧は誰でもできる（DB の forum_create_* も同じ条件・2026-11-23） */
export const forumWriteMinRank = 'silver';
export const canWriteForum = (viewer: PlanViewer) => rankMeets(viewer, forumWriteMinRank);

/** キャンセル規定のグレード。特別会員（platinum）はゴールドの規定を使う（DB の book._cancellation_policy_rank と同じ・2026-11-23） */
export function cancellationPolicyRank(rank: string | null | undefined): 'standard' | 'gold' {
	return rank === 'gold' || rank === 'platinum' ? 'gold' : 'standard';
}
