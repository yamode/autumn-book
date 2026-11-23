// taskul 系（taskul-shift）の shift_assignments から「その人のその日」が休みかどうかを判定する（純粋関数・テスト用に分けた）。
//
// 【判定の根拠】taskul-shared の migration を読んで決めた（2026-11-23）
// - shift_assignments は 1人1日に複数行あり得る（sort_order・半休・ヘルプなど）。
//   20260101000000_baseline_from_prod.sql の列: is_day_off（公休）・is_desired_off（希望休）・holiday_type・half_day_type・pattern_id・custom_start_time。
// - holiday_type はビルトイン（yukyu 有休／daikyu 代休／kekkin 欠勤／keikaku 計画休業）と、
//   テナントが足した休暇区分（shift_leave_types.code・20260809035811_shift_leave_types.sql）が入る。値があれば休暇系の日。
// - 「勤務した日」の判定は taskul 側の集計 SQL と同じにする：
//   is_day_off = false かつ is_desired_off = false かつ holiday_type IS NULL かつ（pattern_id か custom_start_time がある）
//   （20261115041333_shift_leave_types_special_leave.sql の worked、20261009010823_taskul_daily_desk_workers.sql の shift）。
// - half_day_type が非NULL なのは半休（20260518150729_shift_half_day_unique.sql）。勤務の行に付くので出勤扱いにし、注意だけ出す。
// - 何の行も無い・勤務も休みも無い空行だけ（クリア用）の日は「シフト未作成」。

export type ShiftRow = {
	pattern_id: string | null;
	is_day_off: boolean | null;
	is_desired_off: boolean | null;
	holiday_type: string | null;
	half_day_type: string | null;
	custom_start_time: string | null;
};

export type ShiftDay =
	| { kind: 'work'; label: string } // 出勤（label は半休なら「半休」・それ以外は空）
	| { kind: 'off'; label: string } // 休み（公休・希望休・有休 など）→ 開けられない
	| { kind: 'none'; label: string }; // シフト未作成 → 警告付きで開けられる

const BUILTIN_LEAVE: Record<string, string> = { yukyu: '有休', daikyu: '代休', kekkin: '欠勤', keikaku: '計画休業' };

export function classifyShiftDay(rows: ShiftRow[], customLeaveNames: Record<string, string> = {}): ShiftDay {
	const working = rows.filter((r) => !r.is_day_off && !r.is_desired_off && !r.holiday_type && (r.pattern_id || r.custom_start_time));
	if (working.length) return { kind: 'work', label: working.some((r) => r.half_day_type) ? '半休' : '' };
	const off = rows.find((r) => r.is_day_off || r.is_desired_off || r.holiday_type);
	if (off) {
		const label = off.holiday_type
			? (BUILTIN_LEAVE[off.holiday_type] ?? customLeaveNames[off.holiday_type] ?? '休暇')
			: off.is_desired_off
				? '希望休'
				: '公休';
		return { kind: 'off', label };
	}
	return { kind: 'none', label: 'シフト未作成' };
}
