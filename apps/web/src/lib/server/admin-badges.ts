// 管理画面のサイドバーのバッジ（件数）を覚えておく入れ物（routes/admin/+layout.server.ts）。
// 画面遷移のたびに数え直さないよう、ユーザーごとに 60 秒覚える。操作した本人には、すぐ数え直した件数を見せたいので
// 返信・状態の変更・メモの後に clearSupportBadge(userId) で消す（同じ isolate の中だけで効く）。
import { TtlCache } from '$lib/server/ttl-cache';

/** 会員サポートの未返信の件数（docs/member-support.md） */
export const supportBadgeCache = new TtlCache<number | null>(60_000);

/** 会員サポートのバッジの覚えを、このユーザーの分だけ消す */
export function clearSupportBadge(userId: string | null | undefined): void {
	if (userId) supportBadgeCache.delete(userId);
}

/** おたよりで、受付から3週間（21日）たっても「紹介した」も「却下」もしていない件数（book.otayori_overdue_count） */
export const OTAYORI_OVERDUE_DAYS = 21;
export const otayoriBadgeCache = new TtlCache<number | null>(60_000);

/** おたよりのバッジの覚えを、このユーザーの分だけ消す（紹介・却下の後） */
export function clearOtayoriBadge(userId: string | null | undefined): void {
	if (userId) otayoriBadgeCache.delete(userId);
}
