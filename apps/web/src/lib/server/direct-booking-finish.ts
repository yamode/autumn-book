// 公式サイト予約のオンライン決済が確定した後の画面側の後始末（完了画面へ渡す直近予約 cookie）。
// /booking/pay（ブラウザからの確定の連絡）と /booking/pay/return（3Dセキュア等のリダイレクトの戻り）で共有する。
import type { Cookies } from '@sveltejs/kit';
import { setLastBooking, type BookingDraft, type SbHold } from '$lib/server/supabase-data';
import type { DirectConfirmResult } from '$lib/server/direct-payments';

type Paid = Extract<DirectConfirmResult, { result: 'paid' | 'already' }>;

export function finishDirectBooking(cookies: Cookies, hold: SbHold, draft: BookingDraft | null, r: Paid): void {
	const guest = draft && draft.holdId === hold.id ? draft.guest : null;
	const bathTax = r.bathTax ?? 0;
	setLastBooking(cookies, {
		code: r.bookingCode,
		facilityUuid: hold.facilityId,
		roomUuid: hold.roomTypeId,
		planUuid: hold.planId,
		checkin: hold.checkin,
		nights: hold.nights,
		adults: hold.adults,
		// already（Webhook が先に確定）のときは RPC が金額の内訳を返さないので、支払額から戻す（割引・ポイントは足し戻す）
		total: r.total ?? r.amount - bathTax + r.prepayDiscount + (draft?.pointsUsed ?? 0),
		pointsUsed: r.pointsUsed ?? draft?.pointsUsed ?? 0,
		pointsEarned: r.pointsEarned ?? 0,
		payment: 'card',
		// 完了画面の割引行は予約時決済の割引（予約金額からは引かず、支払額からだけ引いた額）
		discountAmount: r.prepayDiscount,
		paidAmount: r.amount,
		bathTax,
		guest: {
			name: guest?.name ?? '',
			kana: guest?.kana ?? '',
			phone: guest?.phone ?? '',
			email: guest?.email ?? ''
		}
	});
}

// 支払は通ったが予約にできなかった（仮押さえの期限切れ等）ときの案内
export const lateMessage = (refunded: boolean) =>
	refunded
		? 'お支払いは完了しましたが、お部屋の確保の期限が過ぎたためご予約を確定できませんでした。お支払いは全額返金しました（カード明細への反映まで数日かかる場合があります）。お手数ですが、もう一度ご予約ください。'
		: 'お支払いは完了しましたが、ご予約を確定できませんでした。返金の手続きに問題が発生したため、お手数ですが宿へお電話でご連絡ください。';
