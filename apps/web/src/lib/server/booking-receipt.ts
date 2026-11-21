// 会員マイページの予約の領収書（2026-11-21）。公式サイトでカード決済した予約（book.direct_payments）から1枚分を組み立てる。
// 「出せるか・金額・内訳・但し書き」は lib/booking-receipt.ts、紙面と PDF 化は客室案内の領収書と共通（lib/inroom-receipt.ts・./inroom-receipt.ts）。
// 本人の予約かどうかは呼び出し側（sbMyReservations で本人の予約一覧から探す）で確かめる。
import { bookingReceiptFigures, BOOKING_PAYMENT_METHOD, stayLabelJa } from '$lib/booking-receipt';
import { normalizeAddressee, type InroomReceiptDoc } from '$lib/inroom-receipt';
import type { DirectPaymentInfo } from './direct-payments';
import { receiptIssuerFor } from './inroom-receipt';
import type { MemberReservation } from './supabase-data';

/** 宛名の既定（予約のお名前） */
export const bookingReceiptDefaultAddressee = (r: Pick<MemberReservation, 'guest'>) => normalizeAddressee(r.guest?.name);

/** 予約の領収書の紙面データ。出せない決済（未決済・全額返金）なら null */
export async function buildBookingReceiptDoc(
	r: Pick<MemberReservation, 'code' | 'facilityUuid' | 'status' | 'checkin' | 'checkout' | 'guest'>,
	pay: DirectPaymentInfo | null,
	addresseeInput: string | null
): Promise<InroomReceiptDoc | null> {
	const fig = bookingReceiptFigures(pay, r.status === 'cancelled');
	if (!fig) return null;
	const issuer = await receiptIssuerFor(r.facilityUuid);
	return {
		...fig,
		...issuer,
		// 宛名欄から来たら（空でも）それを使う。空なら紙面は「上様」。欄を通らない呼び出し（null）だけ予約のお名前
		addressee: addresseeInput != null ? normalizeAddressee(addresseeInput) : bookingReceiptDefaultAddressee(r),
		room: null,
		paymentMethod: BOOKING_PAYMENT_METHOD,
		bookingCode: r.code,
		stayLabel: stayLabelJa(r.checkin, r.checkout),
		statement: null
	};
}
