// 特別会員の専用ページ: 必要な室数を部屋タイプ横断で満たす組み合わせ（例: 和室1室＋洋室1室）。
// 1 つの部屋タイプの残室で足りるプランは通常の一覧に出るので、ここでは「どの部屋タイプ単独でも足りないが、
// 同じプランを持つ部屋タイプを合わせれば足りる」ものだけを返す。残室を見せない取引先（remaining が null）は
// 単独で足りる扱い（確定時にサーバが確かめる）なので組み合わせは出ない。
import type { PartnerStayOffer } from './partner-stay';

export type ComboOffer = Pick<PartnerStayOffer, 'roomCode' | 'roomName' | 'planCode' | 'planName' | 'mealType' | 'perPerson' | 'totalPerPerson' | 'remaining'>;

export interface RoomComboPart {
	roomCode: string;
	roomName: string;
	/** この部屋タイプで取る室数 */
	rooms: number;
	/** 1 名分（全泊）の料金 */
	totalPerPerson: number;
	perPerson: number;
	remaining: number | null;
}

export interface RoomCombo {
	planCode: string;
	planName: string;
	mealType: string | null;
	parts: RoomComboPart[];
	/** 全室・全泊の合計（表示用・確定はサーバが計算し直す） */
	total: number;
}

/**
 * プランごとに、安い部屋タイプから残室いっぱいまで取って rooms 室を満たす組み合わせを作る（安い順）。
 * 同じ金額なら部屋名順。残室の合計が足りないプランは出さない。
 */
export function crossTypeCombos(offers: readonly ComboOffer[], rooms: number, guests: number): RoomCombo[] {
	if (rooms < 2) return [];
	const byPlan = new Map<string, ComboOffer[]>();
	for (const o of offers) {
		const key = `${o.planCode}■${o.planName}`;
		byPlan.set(key, [...(byPlan.get(key) ?? []), o]);
	}
	const out: RoomCombo[] = [];
	for (const group of byPlan.values()) {
		// 残室不明、または単独で足りる部屋タイプがあるなら、通常の一覧で予約できる
		if (group.some((o) => o.remaining == null || o.remaining >= rooms)) continue;
		const sorted = [...group].sort((a, b) => a.perPerson - b.perPerson || a.roomName.localeCompare(b.roomName, 'ja'));
		let need = rooms;
		const parts: RoomComboPart[] = [];
		for (const o of sorted) {
			if (need <= 0) break;
			const take = Math.min(need, o.remaining ?? 0);
			if (take <= 0) continue;
			parts.push({ roomCode: o.roomCode, roomName: o.roomName, rooms: take, totalPerPerson: o.totalPerPerson, perPerson: o.perPerson, remaining: o.remaining });
			need -= take;
		}
		if (need > 0 || parts.length < 2) continue;
		out.push({
			planCode: group[0].planCode,
			planName: group[0].planName,
			mealType: group[0].mealType,
			parts,
			total: parts.reduce((s, p) => s + Math.round(p.totalPerPerson * guests) * p.rooms, 0)
		});
	}
	return out.sort((a, b) => a.total - b.total || a.planName.localeCompare(b.planName, 'ja'));
}
