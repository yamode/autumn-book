// 客室の「定員○名・○㎡」。広さが未登録（0）の客室は定員だけにする（「0㎡」と出ていた・2026-11-02）。
import * as m from '$lib/paraglide/messages';

export function roomCapacityText(room: { capacity: number; sizeM2: number }): string {
	return room.sizeM2 > 0 ? m.room_detail_capacity({ n: String(room.capacity), size: String(room.sizeM2) }) : m.room_capacity_only({ n: String(room.capacity) });
}
