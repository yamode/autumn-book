// 予約管理（/admin/reservations）で取引先予約（限定URL /p/<token> から入った予約）を見分けるための純関数。
//
// 取引先予約の実体:
//   - 台帳: public.rms_partner_bookings（booking_code = PB-YYYY-NNNNNN）
//   - core.stays: source = channel_code = 'rms_partner'。reservation_code は 1室なら PB-YYYY-NNNNNN、
//     複数室なら末尾に -1, -2 …（部屋ごとに1行）
//   - booking.bookings: 1行目の滞在にだけ付く。metadata.booking_code = PB-YYYY-NNNNNN・metadata.source = 'rms_partner'
//
// booking.bookings 行があるため、予約管理の詳細画面は以前「直販」と誤認して book 側の取消・メール再送・
// 会員紐づけを出していた。取引先予約の取消は台帳・Stripe 返金・取引先メールを通す必要があるので、
// book 側の操作は必ずここで弾く（サーバ側・画面側の両方）。DB・Supabase に触らないので単体テストできる。

export const PARTNER_SOURCE = 'rms_partner';

/** 取引先予約の予約番号（台帳の booking_code、または複数室の滞在の reservation_code） */
const PARTNER_CODE_RE = /^(PB-\d{4}-\d{6})(?:-(\d+))?$/;

/** 予約が取引先予約か（admin_booking_detail / admin_list_bookings の source・channel_code で判定） */
export function isPartnerStay(b: { source?: string | null; channel_code?: string | null } | null | undefined): boolean {
	if (!b) return false;
	return b.source === PARTNER_SOURCE || b.channel_code === PARTNER_SOURCE;
}

/** 予約番号が取引先予約の形（PB-YYYY-NNNNNN、末尾 -N 付きも含む）か */
export const isPartnerReservationCode = (code: string | null | undefined): boolean => PARTNER_CODE_RE.test((code ?? '').trim());

/**
 * 予約番号（滞在の reservation_code または予約の booking_code）から、台帳の booking_code を取り出す。
 * 複数室の末尾 -N は除く。取引先予約の形でなければ null。
 */
export function partnerBookingCodeOf(code: string | null | undefined): string | null {
	const m = PARTNER_CODE_RE.exec((code ?? '').trim());
	return m ? m[1] : null;
}

/**
 * 予約管理の詳細 URL に台帳の予約番号（末尾 -N 無し）が来たが、その番号の滞在が無いときの読み替え先。
 * 複数室の取引先予約は滞在が PB-…-1, -2 … なので、一覧から（metadata.booking_code で）来ると見つからない。
 * 1室目（-1）へ回す。取引先予約の台帳番号でなければ null。
 */
export function partnerFirstRoomCode(code: string | null | undefined): string | null {
	const m = PARTNER_CODE_RE.exec((code ?? '').trim());
	if (!m || m[2] !== undefined) return null;
	return `${m[1]}-1`;
}

/** 予約管理（book 側）の操作を取引先予約に使わせないときの文言 */
export const PARTNER_BOOK_ACTION_DENIED =
	'取引先予約のため、この操作はできません。取消・再請求は下の「取引先予約」欄（または取引先の管理画面）から行ってください。宿泊者へのメールは送りません。';

/** 台帳の支払状況（rms_partner_bookings.payment_status）の表示名 */
export function partnerPaymentStatusLabel(status: string | null | undefined, cardLabel?: string | null): string {
	switch (status) {
		case 'none':
			return '後払い（請求書など）';
		case 'unpaid':
			return '支払待ち';
		case 'paid':
			return '支払済み';
		case 'scheduled':
			return `チェックイン日に請求${cardLabel ? `（${cardLabel}）` : ''}`;
		case 'charge_failed':
			return '請求失敗';
		case 'refunded':
			return '返金済み';
		case 'refund_failed':
			return '返金失敗（Stripe で対応が必要）';
		default:
			return status || '—';
	}
}

/** 台帳の予約状態（rms_partner_bookings.status）の表示名 */
export function partnerBookingStatusLabel(status: string | null | undefined, checkedIn = false): string {
	if (status === 'pending_payment') return '支払待ち（仮押さえ）';
	if (status === 'expired') return '支払期限切れ';
	if (status === 'cancelled') return '取消';
	if (checkedIn) return 'チェックイン済み';
	if (status === 'confirmed') return '予約中';
	return status || '—';
}

/** 取消できる状態か（/admin/partners/[id] の一覧と同じ条件。チェックイン済みは不可） */
export const canStaffCancelPartnerBooking = (b: { status: string; checkedIn?: boolean }) =>
	(b.status === 'confirmed' || b.status === 'pending_payment') && !b.checkedIn;

/** チェックイン日決済の再請求（または当日の今すぐ請求）を出せるか（/admin/partners/[id] と同じ条件） */
export const canRetryPartnerCharge = (
	b: { status: string; paymentOption: string | null; paymentStatus: string; checkIn: string },
	todayIso: string
) =>
	b.status === 'confirmed' &&
	b.paymentOption === 'online_checkin' &&
	(b.paymentStatus === 'charge_failed' || (b.paymentStatus === 'scheduled' && b.checkIn <= todayIso));
