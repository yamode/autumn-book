// 予約管理（一覧・詳細）で共通の状態の表示名とバッジの色（2026-10-17 管理画面のモダン化 第2段階）。
// 一覧と詳細で色がずれないように、ここだけで決める。

/** core.stays.status → 表示名 */
export const STAY_STATUS: Record<string, string> = {
	reserved: '予約済',
	checked_in: 'チェックイン済',
	checked_out: '宿泊済',
	stayed: '宿泊済',
	cancelled: 'キャンセル',
	no_show: '不泊'
};

/** バッジの共通の形（丸み・大きさ・枠） */
export const BADGE = 'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset';

/** 滞在の状態のバッジの色。予約済＝緑・取消/不泊＝灰・チェックイン/宿泊済＝青 */
export function stayStatusClass(s: string): string {
	if (s === 'reserved') return `${BADGE} bg-emerald-50 text-emerald-700 ring-emerald-200`;
	if (s === 'cancelled' || s === 'no_show') return `${BADGE} bg-stone-100 text-stone-500 ring-stone-200`;
	return `${BADGE} bg-sky-50 text-sky-700 ring-sky-200`;
}
