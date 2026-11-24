// お部屋のポップの QR（/r/start?k=<部屋の鍵>・トークンなし）を読んだときに、
// その端末が持っている滞在（ab_stay Cookie）を保つか外すかを決める純関数。
//
// なぜ部屋が違えば外すのか: 食事時間と貸切風呂は既定では部屋ごとに分かれている（book._stay_chain は
//   複数室のグループでは assigned_room_id が同じ泊だけを拾う）。別の部屋の滞在を持ったまま見せると、
//   読んだ部屋の食事時間・風呂の枠として誤った値が出る（2026-11-24 指示）。
//
// ただし PMS でグループの部屋どうしを「共有」にしている場合は外さない。設定は2つ（pms.stay_groups.metadata）:
//   ・貸切風呂 private_bath_shared（館内図・予約詳細のスイッチ）
//   ・食事 meal_split（予約詳細の「食事の席」: まとめる／部屋ごと／N分割）
//   両方が共有のときだけ、book.stay_shared_rooms がグループの部屋を sharedRooms に入れて返す。
//   どちらか一方でも部屋ごとなら sharedRooms は自分の部屋だけ。
//
// 2026-11-21 は逆に「部屋番号が違っても外さない」にしていた。本人の滞在が消えていた原因は、
//   比べていた値が book.stay_access_tokens.room_code（非正規化・部屋の割り当て変更に追従しない）
//   だったこと。sharedRooms は core.stays.assigned_room_id から引いた「いまの割り当て」なので、
//   移動した本人が新しい部屋の QR を読んでも滞在は保たれる。
//
// 分からないときは必ず 'keep'（外さない）に倒す。滞在が消えて6桁コードの再入力を求めるのが
//   いちばん重い失敗なので、判断が付かないときは保つ。

export type StayRoomMatch = {
	/** 端末が持っている滞在の施設 slug */
	stayFacilitySlug: string;
	/**
	 * その滞在と入れ替えても同じ案内（食事時間・風呂の枠）が見える部屋番号（自分の部屋を含む）。
	 * book.stay_shared_rooms の shared_rooms。分からなければ空配列
	 */
	sharedRooms: readonly string[];
	/** いま読んだ QR の施設 slug */
	scannedFacilitySlug: string;
	/** いま読んだ QR の部屋番号 */
	scannedRoomCode: string;
};

/** keep=滞在を保つ / other-facility=別の施設なので外す / other-room=共有していない別の部屋なので外す */
export type StayRoomDecision = 'keep' | 'other-facility' | 'other-room';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export function decideStayForScannedRoom(m: StayRoomMatch): StayRoomDecision {
	const stayFacility = norm(m.stayFacilitySlug);
	const scannedFacility = norm(m.scannedFacilitySlug);
	// どちらかの施設が分からないときは外さない
	if (stayFacility && scannedFacility && stayFacility !== scannedFacility) return 'other-facility';

	const shared = m.sharedRooms.map(norm).filter(Boolean);
	const scannedRoom = norm(m.scannedRoomCode);
	// 部屋が分からないとき（割り当て前・鍵が部屋名を持たない）は外さない
	if (!shared.length || !scannedRoom) return 'keep';
	return shared.includes(scannedRoom) ? 'keep' : 'other-room';
}
