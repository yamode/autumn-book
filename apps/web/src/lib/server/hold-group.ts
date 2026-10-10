// 公式サイトの複数室予約（docs/official-multi-room.md §8.3・M1）: 仮押さえの束の部屋ごとの表示と、全室で合わせた支払方法。
// 予約入力（/booking/hold）・現地払いの確定（?/submit）・オンライン決済の準備（/booking/pay）で同じ判定を使う。
import type { HoldGroup } from '$lib/multi-room';
import { combinePayments } from '$lib/multi-room';
import { memberOnsiteHint, planForViewer } from '$lib/member-payment';
import type { PaymentConfig, RatePlan, RoomType } from '$lib/types';
import { sbPlanByUuid, sbRoomTypeByUuid } from '$lib/server/supabase-data';

export type HoldGroupRoomView = {
	/** 1 始まり */
	index: number;
	room: RoomType;
	/** 閲覧者（会員かどうか）に合わせたプラン */
	plan: RatePlan;
	/** 元のプラン（非会員の案内の判定用） */
	basePlan: RatePlan;
	adults: number;
	quote: HoldGroup['rooms'][number]['quote'];
};

/** 束の部屋ごとのプラン・部屋タイプ。読めない部屋があれば null（期限切れ扱い） */
export async function loadHoldGroupRooms(hold: HoldGroup, isMember: boolean): Promise<HoldGroupRoomView[] | null> {
	const planIds = [...new Set(hold.rooms.map((r) => r.planId))];
	const roomIds = [...new Set(hold.rooms.map((r) => r.roomTypeId))];
	const [plans, rooms] = await Promise.all([
		Promise.all(planIds.map(async (id) => [id, await sbPlanByUuid(id)] as const)),
		Promise.all(roomIds.map(async (id) => [id, await sbRoomTypeByUuid(id)] as const))
	]);
	const planMap = new Map(plans);
	const roomMap = new Map(rooms);
	const out: HoldGroupRoomView[] = [];
	for (const r of hold.rooms) {
		const basePlan = planMap.get(r.planId);
		const room = roomMap.get(r.roomTypeId);
		if (!basePlan || !room) return null;
		out.push({ index: r.index, room, plan: planForViewer(basePlan, isMember), basePlan, adults: r.adults, quote: r.quote });
	}
	return out;
}

/**
 * 全室で合わせた支払設定（全室で許されているものだけ・Q3）。1 室はそのプランの設定そのもの。
 * 予約時決済の割引率などの表示用の値は 1 室目のもの（金額は部屋ごとに計算する）。
 */
export function groupPayment(rooms: Pick<HoldGroupRoomView, 'plan'>[]): PaymentConfig {
	if (rooms.length === 1) return rooms[0].plan.payment;
	const c = combinePayments(rooms.map((r) => r.plan.payment));
	return { ...rooms[0].plan.payment, onsite: c.onsite, prepay: c.prepay, prepayMethods: c.prepayMethods };
}

/** 非会員は予約時決済のみ・会員なら現地払いも選べる部屋があるか（「会員の方は現地払いも…」の案内） */
export function groupMemberOnsiteHint(rooms: Pick<HoldGroupRoomView, 'basePlan'>[], isMember: boolean): boolean {
	return rooms.some((r) => memberOnsiteHint(r.basePlan.payment, isMember));
}
