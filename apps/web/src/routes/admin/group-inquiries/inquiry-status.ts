// 団体照会（一覧・詳細）で共通の状態バッジの色（2026-10-17 管理画面のモダン化 第2段階）。
// 予約管理のバッジ（routes/admin/reservations/stay-status.ts）と同じ形・同じ色の考え方にそろえる。
import type { GroupInquiryStatus } from '$lib/partner-group';

/** バッジの共通の形（丸み・大きさ・枠） */
export const BADGE = 'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset';

/** 新着（回答待ち）＝琥珀・回答済み＝空色・予約確定＝緑・終了＝灰 */
export function inquiryStatusClass(s: GroupInquiryStatus): string {
	if (s === 'submitted') return `${BADGE} bg-amber-50 text-amber-800 ring-amber-300`;
	if (s === 'offered') return `${BADGE} bg-sky-50 text-sky-700 ring-sky-200`;
	if (s === 'accepted') return `${BADGE} bg-emerald-50 text-emerald-700 ring-emerald-200`;
	return `${BADGE} bg-stone-100 text-stone-500 ring-stone-200`;
}
