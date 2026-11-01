// 会員のお気に入り（部屋単位・book.favorite_rooms）を公開ページで使うための読み出し（2026-11-02）。
//   favoriteRoomTypeIds … お気に入りの部屋がある部屋タイプ id。プラン一覧・客室選択の部屋タイプのブロックに「お気に入り」と出す。
// 会員でない・デモ（MEMBER_SUPABASE でない）・読めないときは空（表示しないだけで画面は止めない）。
import type { RequestEvent } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from './auth';
import { sbFavoriteRoomChoices, sbListFavoriteRoomTypes, sbSetHoldFavoriteRooms, type FavoriteRoomChoice } from './supabase-data';

type AuthEvent = Pick<RequestEvent, 'locals' | 'cookies' | 'url' | 'request'>;
const isMemberSession = (event: AuthEvent) => MEMBER_SUPABASE && event.locals.user?.role === 'member';

/** 予約確認画面: 仮押さえの部屋タイプの中で、お気に入りかつその日程に空いている部屋（部屋の番号ごと）。会員でなければ空 */
export async function favoriteRoomChoicesFor(event: AuthEvent, holdId: string, sessionId: string): Promise<Record<number, FavoriteRoomChoice[]>> {
	if (!isMemberSession(event)) return {};
	const list = await sbFavoriteRoomChoices(createSupabaseServerClient(event as RequestEvent), holdId, sessionId).catch(() => []);
	const out: Record<number, FavoriteRoomChoice[]> = {};
	for (const c of list) (out[c.roomIndex] ??= []).push(c);
	return out;
}

/**
 * 確定の直前: フォームの fav_<部屋の番号>（選んだお気に入りの部屋 id）を仮押さえに残す。確定のときに DB がもう一度空きを確かめて部屋指定する。
 * 会員でない・何も選んでいないときは何もしない（前に選んだものは取り消す）。指定できない値ならエラー文を返す。
 */
export async function saveFavoriteRoomChoices(event: AuthEvent, holdId: string, sessionId: string, form: FormData): Promise<string | null> {
	if (!isMemberSession(event)) return null;
	const choices: { roomIndex: number; roomId: string }[] = [];
	for (const [key, value] of form.entries()) {
		const m = /^fav_(\d+)$/.exec(key);
		const roomId = String(value ?? '').trim();
		if (m && roomId) choices.push({ roomIndex: Number(m[1]), roomId });
	}
	try {
		await sbSetHoldFavoriteRooms(createSupabaseServerClient(event as RequestEvent), holdId, sessionId, choices);
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
}

export async function favoriteRoomTypeIds(event: Pick<RequestEvent, 'locals' | 'cookies' | 'url' | 'request'>): Promise<string[]> {
	if (!MEMBER_SUPABASE || event.locals.user?.role !== 'member') return [];
	try {
		return await sbListFavoriteRoomTypes(createSupabaseServerClient(event as RequestEvent));
	} catch {
		return [];
	}
}
