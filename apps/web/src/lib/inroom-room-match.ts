// お部屋のポップの QR（/r/start?k=<部屋の鍵>・トークンなし）を読んだときに、
// その端末が持っている滞在（ab_stay Cookie）を保つか外すかを決める純関数。
//
// なぜ部屋が違えば外すのか: 食事時間（book.stay_meal_times）と貸切風呂は book._stay_chain を通して
//   読んでいて、_stay_chain は複数室のグループでは assigned_room_id が同じ泊だけを拾う。つまり
//   食事・風呂は部屋ごとに分かれている。別の部屋の滞在を持ったまま見せると、読んだ部屋の
//   食事時間・風呂の枠として誤った値が出る（2026-11-24 指示）。
//
// 2026-11-21 は逆に「部屋番号が違っても外さない」にしていた。本人の滞在が消える苦情の原因は
//   部屋番号そのものではなく、比べていた値が book.stay_access_tokens.room_code（非正規化・部屋の
//   割り当て変更に追従しない）だったこと。ここで比べるのは book.stay_room_now が返す「いまの割り当て」
//   なので、移動した本人が新しい部屋の QR を読んでも滞在は保たれる。
//
// 分からないときは必ず 'keep'（外さない）に倒す。滞在が消えて6桁コードの再入力を求めるのが
//   いちばん重い失敗なので、判断が付かないときは保つ。

export type StayRoomMatch = {
	/** 端末が持っている滞在の施設 slug */
	stayFacilitySlug: string;
	/** その滞在が「いま」割り当てられている部屋番号。分からなければ null */
	stayRoomCode: string | null;
	/** いま読んだ QR の施設 slug */
	scannedFacilitySlug: string;
	/** いま読んだ QR の部屋番号 */
	scannedRoomCode: string;
};

/** keep=滞在を保つ / other-facility=別の施設なので外す / other-room=別の部屋なので外す */
export type StayRoomDecision = 'keep' | 'other-facility' | 'other-room';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export function decideStayForScannedRoom(m: StayRoomMatch): StayRoomDecision {
	const stayFacility = norm(m.stayFacilitySlug);
	const scannedFacility = norm(m.scannedFacilitySlug);
	// どちらかの施設が分からないときは外さない
	if (stayFacility && scannedFacility && stayFacility !== scannedFacility) return 'other-facility';

	const stayRoom = norm(m.stayRoomCode);
	const scannedRoom = norm(m.scannedRoomCode);
	// 部屋が分からないとき（割り当て前・鍵が部屋名を持たない）は外さない
	if (!stayRoom || !scannedRoom) return 'keep';
	return stayRoom === scannedRoom ? 'keep' : 'other-room';
}
