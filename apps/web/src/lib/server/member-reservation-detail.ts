// 会員の予約詳細（公式マイページ /account/reservations/[code] と、特別会員の専用ページのご予約一覧 /p/<token>/bookings/<code>）で
// 共通の読み出し（部屋ごとのカード・キャンセル料と返金の見込み・オプション・変更履歴・変更可否）。
// 2026-10-11 に account/reservations/[code]/+page.server.ts から切り出した（docs/vip-member-page.md §13.4.3b）。
// 読み取りはどちらも会員の authenticated クライアント（book.my_reservations / compute_cancel_fee / list_my_*）。
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { liveRooms, remainingRefundPreview, roomRefundPreview, type BookingRoom, type RefundTerms, type RoomRefundPreview } from '$lib/multi-room';
import { todayStr } from '$lib/format';
import {
	sbComputeCancelFee,
	sbListRankCancelPolicies,
	sbListMyBookingOptions,
	sbListMyAmendments,
	sbRoomTypeByUuid,
	sbPlanByUuid,
	sbMyReservations,
	type MemberReservation
} from '$lib/server/supabase-data';
import { memberPageHrefFor } from '$lib/server/partners/member-bookings';
import { directPaymentForBooking, directRefundPreviewOf, prepayBonusPointsOf, type DirectPaymentInfo } from '$lib/server/direct-payments';
import { CANCEL_POLICY_LABELS, type MemberPerkSnapshot } from '$lib/partner-member-page';

// 変更可否ゲート（会員 & reserved & 締切前 & 残回数あり）。
// 締切 = チェックイン日 9:00 施設TZ（≒ JST）。9:00 JST = 当日 00:00 UTC。上限2回。
export function amendGate(status: string, checkin: string, amendCount: number) {
	const deadlinePassed = Date.now() >= Date.parse(checkin + 'T00:00:00Z');
	const remaining = Math.max(0, 2 - amendCount);
	return {
		remaining,
		deadlinePassed,
		canAmend: status === 'reserved' && !deadlinePassed && remaining > 0
	};
}

/** 複数室の予約の部屋ごとのカード（部屋名・プラン名・人数・金額・状態・この部屋だけ取り消したときのキャンセル料と返金見込み） */
export async function multiRoomCards(
	rooms: BookingRoom[],
	opts: { fees?: Map<number, { fee: number; rate: number; rulesSource?: string }>; pay?: DirectPaymentInfo | null; cancellable?: boolean } = {}
) {
	const terms: RefundTerms | null =
		opts.pay && opts.pay.status === 'paid'
			? {
					adminFeePercent: opts.pay.cancel_admin_fee_percent == null ? null : Number(opts.pay.cancel_admin_fee_percent),
					adminFeeWaived: opts.pay.cancel_admin_fee_waived === true
				}
			: null;
	const names = new Map<string, string>();
	await Promise.all(
		[...new Set(rooms.flatMap((x) => [`r:${x.roomTypeId}`, x.planId ? `p:${x.planId}` : '']).filter(Boolean))].map(async (k) => {
			const id = k.slice(2);
			const v = k.startsWith('r:') ? await sbRoomTypeByUuid(id).catch(() => undefined) : await sbPlanByUuid(id).catch(() => undefined);
			names.set(k, v?.name ?? '');
		})
	);
	return rooms.map((x) => ({
		index: x.index,
		stayCode: x.stayCode,
		roomName: names.get(`r:${x.roomTypeId}`) ?? '',
		planName: x.planId ? (names.get(`p:${x.planId}`) ?? '') : '',
		adults: x.adults,
		total: x.charge,
		cancelled: x.cancelled,
		cancelFee: x.cancelFee,
		/** この部屋だけ取り消せるか（予約中・この部屋が生きていて reserved） */
		canCancel: !!opts.cancellable && !x.cancelled && (x.stayStatus ?? 'reserved') === 'reserved',
		/** 今日この部屋を取り消したときのキャンセル料 */
		fee: opts.fees?.get(x.index) ?? null,
		/** オンライン決済済みの予約: この部屋の返金見込み（DB の _room_cancel_kept と同じ式） */
		refundPreview:
			terms && !x.cancelled && x.paidShare != null
				? roomRefundPreview(
						{ paidShare: x.paidShare, bathTax: x.bathTax, prepayDiscount: x.prepayDiscount },
						opts.fees?.get(x.index)?.fee ?? 0,
						terms
					)
				: null,
		/** 特別会員の専用ページ経由: この部屋の専用特典（無ければ null） */
		memberPerks: (x.memberPerks ?? null) as MemberPerkSnapshot[] | null,
		/** このお部屋のキャンセル料の規定の出どころ（plan / rank / member_page）。分からなければ null */
		cancelRulesSource: (opts.fees?.get(x.index)?.rulesSource ?? null) as string | null
	}));
}

/** 2 室以上の予約で残りの部屋をすべて取り消したときの返金見込み（DB の direct_payment_refund_due と同じ考え方） */
export function multiRemainingRefund(rooms: BookingRoom[], fees: Map<number, { fee: number }>, pay: DirectPaymentInfo): RoomRefundPreview | null {
	if (rooms.some((x) => x.paidShare == null)) return null;
	return remainingRefundPreview(
		{
			amount: pay.amount,
			refunded: pay.refunded_amount,
			bathTax: pay.bath_tax_amount,
			prepayDiscount: pay.prepay_discount_amount ?? 0
		},
		liveRooms(rooms).map((x) => ({ paidShare: x.paidShare ?? 0, bathTax: x.bathTax, prepayDiscount: x.prepayDiscount, fee: fees.get(x.index)?.fee ?? 0 })),
		rooms.filter((x) => x.cancelled).map((x) => ({ cancelKept: x.cancelKept ?? 0 })),
		{
			adminFeePercent: pay.cancel_admin_fee_percent == null ? null : Number(pay.cancel_admin_fee_percent),
			adminFeeWaived: pay.cancel_admin_fee_waived === true
		}
	);
}

/**
 * 実データの予約詳細（MEMBER_SUPABASE）。client は会員の authenticated クライアント。
 * 戻りは公式マイページの load の形（facility を除く）＋ memberPage（専用ページ経由なら方式の表示名つき）
 */
export async function reservationDetailOf(event: RequestEvent, client: SupabaseClient, r: MemberReservation) {
	const today = todayStr();
	const booking = {
		code: r.code,
		status: r.status,
		channel: r.channel,
		checkin: r.checkin,
		nights: r.nights,
		adults: r.adults,
		guest: r.guest,
		total: r.total,
		pointsUsed: r.pointsUsed,
		pointsEarned: r.pointsEarned,
		payment: r.payment,
		paymentStatus: r.paymentStatus,
		cancelFee: r.cancelFee,
		cancellationPolicy: r.cancellationPolicy
	};
	void event;
	// 滞在アレンジ（オプション）明細。変更履歴・変更可否
	const [options, amendments] = await Promise.all([sbListMyBookingOptions(client, r.code), sbListMyAmendments(client, r.code)]);
	// キャンセル料プレビュー（グレード別規定・P3）。適用ルール表は plan/rank で出所を分けて補完する（member_page は予約の規定）
	let cancelPreview = null;
	if (r.status === 'reserved') {
		const base = await sbComputeCancelFee(client, r.code, today);
		const rules =
			base.rulesSource === 'rank'
				? ((await sbListRankCancelPolicies()).find((p) => p.rankCode === base.rankCode)?.rules ?? [])
				: base.rulesSource === 'member_page' && r.memberPage?.cancelRules.length
					? r.memberPage.cancelRules
					: r.cancellationPolicy.rules;
		cancelPreview = { ...base, rules };
	}
	// オンライン決済の台帳（取消の返金見込み・早期決済ポイントの表示用）。現地払いの予約は引かない
	const pay = r.payment !== 'onsite' ? await directPaymentForBooking(r.code).catch(() => null) : null;
	const multiRoom = (r.rooms?.length ?? 0) > 1;
	// 部屋ごとのキャンセル料（2 室以上・compute_cancel_fee の rooms[]。生きている部屋だけ）
	const roomFees = new Map<number, { fee: number; rate: number; rulesSource?: string }>(
		(cancelPreview?.rooms ?? []).map((x) => [x.index, { fee: x.fee, rate: x.rate, rulesSource: x.rulesSource }])
	);
	// 生きている部屋が 1 室だけのとき、DB（_booking_cancel_fee）は rooms[] を返さず全体の fee / rate がその部屋の値
	const liveOnly = (r.rooms ?? []).filter((x) => !x.cancelled);
	if (multiRoom && cancelPreview && roomFees.size === 0 && liveOnly.length === 1) {
		roomFees.set(liveOnly[0].index, { fee: cancelPreview.fee, rate: cancelPreview.rate, rulesSource: cancelPreview.rulesSource });
	}
	// 取り消したときの返金の見込み（予約時決済の割引額は返金しない）。2 室以上は「残りの部屋をすべて」の見込み
	const refundPreview =
		cancelPreview && pay && pay.status === 'paid'
			? multiRoom
				? multiRemainingRefund(r.rooms ?? [], roomFees, pay)
				: directRefundPreviewOf(pay, cancelPreview.fee)
			: null;
	// 早期決済ポイント（施設が points のときの予約）。取消された予約には付与されないので出さない
	const bonusPoints = pay && pay.status === 'paid' && r.status !== 'cancelled' ? prepayBonusPointsOf(pay) : 0;
	const prepayBonus = bonusPoints > 0 ? { points: bonusPoints, granted: !!pay?.prepay_bonus_granted_at } : null;
	// 複数室: 部屋ごとのカード（M1）・1 室ずつの取消（M2）。人数は生きている部屋の和（全室取消なら全室）
	const rooms = multiRoom
		? await multiRoomCards(r.rooms ?? [], {
				fees: roomFees,
				pay,
				// 1 室ずつの取消は「生きている部屋がすべて reserved」のときだけ（DB の _cancel_booking_room_core と同じ）
				cancellable: r.status === 'reserved' && liveOnly.every((x) => (x.stayStatus ?? 'reserved') === 'reserved')
			})
		: [];
	const shown = rooms.some((x) => !x.cancelled) ? rooms.filter((x) => !x.cancelled) : rooms;
	return {
		booking: multiRoom ? { ...booking, adults: shown.reduce((s, x) => s + x.adults, 0) } : booking,
		checkout: r.checkout,
		options,
		amendments,
		rooms,
		multiRoom,
		// 2 室以上は日付・泊数だけの変更（全室同時・M2）。規則（締切・2 回まで）は 1 室と同じ
		amend: { ...amendGate(r.status, r.checkin, amendments.length), datesOnly: multiRoom },
		// プラン/客室マスタ（rate_plan_id / room_type_id UUID）は公開コンテンツ未投入のため名称未解決
		plan: { name: '', cancellationPolicy: r.cancellationPolicy },
		room: { name: '' },
		cancelPreview,
		refundPreview,
		prepayBonus,
		// 1 室の予約の専用特典（2 室以上は rooms[i].memberPerks）
		memberPerks: (r.rooms?.[0]?.memberPerks ?? null) as MemberPerkSnapshot[] | null,
		// 特別会員の専用ページ経由の予約（方式の表示名つき）。公式サイトから予約した分は null
		memberPage: r.memberPage
			? {
					partnerId: r.memberPage.partnerId,
					pageName: r.memberPage.pageName,
					via: r.memberPage.via,
					cancelMode: r.memberPage.cancelPolicyMode,
					cancelModeLabel: CANCEL_POLICY_LABELS[r.memberPage.cancelPolicyMode],
					cancelRules: r.memberPage.cancelRules
				}
			: null
	};
}

/**
 * 公式マイページの操作（取消・日程変更・オプション）の前に呼ぶ: 特別会員の専用ページ経由の予約なら、案内（専用ページの予約詳細の URL）を返す。
 * そうでなければ null。DB のガード（book._member_page_guard）でも止まるが、案内の文言を出すためにここで先に断る（§13.4.4）
 */
export async function memberPageBookingOf(client: SupabaseClient, code: string): Promise<{ href: string | null } | null> {
	const r = (await sbMyReservations(client).catch(() => [] as MemberReservation[])).find((x) => x.code === code);
	if (!r?.memberPage) return null;
	return { href: await memberPageHrefFor(r.memberPage.partnerId, code).catch(() => null) };
}

/** 公式マイページで専用ページ経由の予約を操作しようとしたときの fail の中身 */
export const MEMBER_PAGE_BOOKING_MESSAGE = 'このご予約の変更・取消は、特別会員ページのご予約一覧から行えます。';
