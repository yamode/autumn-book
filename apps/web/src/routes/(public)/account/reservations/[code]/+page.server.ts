import { error, fail } from '@sveltejs/kit';
import {
	bookings,
	facilityById,
	planById,
	roomTypeById,
	cancelBooking,
	computeCancelFee,
	listMyBookingOptions,
	cancelBookingOption,
	listMyAmendments
} from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import {
	sbMyReservations,
	sbCancelBookingAsMember,
	sbCancelBookingRoomAsMember,
	sbComputeCancelFee,
	sbListRankCancelPolicies,
	sbListMyBookingOptions,
	sbCancelBookingOption,
	sbListMyAmendments,
	reverseFacilityUuid,
	sbRoomTypeByUuid,
	sbPlanByUuid
} from '$lib/server/supabase-data';
import { addDays } from '@autumn-book/core';
import { liveRooms, remainingRefundPreview, roomRefundPreview, type BookingRoom, type RefundTerms, type RoomRefundPreview } from '$lib/multi-room';
import { todayStr } from '$lib/format';
import * as m from '$lib/paraglide/messages';
import {
	directPaymentForBooking,
	directRefundPreviewOf,
	prepayBonusPointsOf,
	refundAfterCancel,
	type DirectPaymentInfo
} from '$lib/server/direct-payments';
import type { Actions, PageServerLoad } from './$types';

// 変更可否ゲート（会員 & reserved & 締切前 & 残回数あり）。
// 締切 = チェックイン日 9:00 施設TZ（≒ JST）。9:00 JST = 当日 00:00 UTC。上限2回。
function amendGate(status: string, checkin: string, amendCount: number) {
	const deadlinePassed = Date.now() >= Date.parse(checkin + 'T00:00:00Z');
	const remaining = Math.max(0, 2 - amendCount);
	return {
		remaining,
		deadlinePassed,
		canAmend: status === 'reserved' && !deadlinePassed && remaining > 0
	};
}

/** 複数室の予約の部屋ごとのカード（部屋名・プラン名・人数・金額・状態・この部屋だけ取り消したときのキャンセル料と返金見込み） */
async function multiRoomCards(
	rooms: BookingRoom[],
	opts: { fees?: Map<number, { fee: number; rate: number }>; pay?: DirectPaymentInfo | null; cancellable?: boolean } = {}
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
				: null
	}));
}

/** 2 室以上の予約で残りの部屋をすべて取り消したときの返金見込み（DB の direct_payment_refund_due と同じ考え方） */
function multiRemainingRefund(rooms: BookingRoom[], fees: Map<number, { fee: number }>, pay: DirectPaymentInfo): RoomRefundPreview | null {
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

export const load: PageServerLoad = async (event) => {
	const { params, locals } = event;
	const today = todayStr();

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		const reservations = await sbMyReservations(client);
		const r = reservations.find((x) => x.code === params.code);
		if (!r) error(404, m.error_booking_not_found());
		const storeId = reverseFacilityUuid(r.facilityUuid);
		const facility = storeId ? facilityById(storeId) : undefined;
		if (!facility) error(404, m.error_booking_not_found());
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
		// 滞在アレンジ（オプション）明細。締切表示用に checkout（提供日セレクトの上限）も返す。
		const options = await sbListMyBookingOptions(createSupabaseServerClient(event), r.code);
		// 変更履歴・変更可否
		const amendments = await sbListMyAmendments(client, r.code);
		// キャンセル料プレビュー（グレード別規定・P3）。適用ルール表は plan/rank で出所を分けて補完する。
		let cancelPreview = null;
		if (r.status === 'reserved') {
			const base = await sbComputeCancelFee(client, r.code, today);
			const rules =
				base.rulesSource === 'plan'
					? r.cancellationPolicy.rules
					: ((await sbListRankCancelPolicies()).find((p) => p.rankCode === base.rankCode)?.rules ?? []);
			cancelPreview = { ...base, rules };
		}
		// オンライン決済の台帳（取消の返金見込み・早期決済ポイントの表示用）。現地払いの予約は引かない
		const pay = r.payment !== 'onsite' ? await directPaymentForBooking(r.code).catch(() => null) : null;
		const multiRoom = (r.rooms?.length ?? 0) > 1;
		// 部屋ごとのキャンセル料（2 室以上・compute_cancel_fee の rooms[]。生きている部屋だけ）
		const roomFees = new Map((cancelPreview?.rooms ?? []).map((x) => [x.index, { fee: x.fee, rate: x.rate }]));
		// 生きている部屋が 1 室だけのとき、DB（_booking_cancel_fee）は rooms[] を返さず全体の fee / rate がその部屋の値
		const liveOnly = (r.rooms ?? []).filter((x) => !x.cancelled);
		if (multiRoom && cancelPreview && roomFees.size === 0 && liveOnly.length === 1) {
			roomFees.set(liveOnly[0].index, { fee: cancelPreview.fee, rate: cancelPreview.rate });
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
			facility,
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
			prepayBonus
		};
	}

	const booking = bookings.get(params.code);
	if (!booking || booking.memberId !== locals.user!.id) error(404, m.error_booking_not_found());
	const options = listMyBookingOptions(params.code, locals.user!.id);
	const amendments = listMyAmendments(params.code, locals.user!.id);
	return {
		booking,
		facility: facilityById(booking.facilityId)!,
		checkout: addDays(booking.checkin, booking.nights),
		options,
		amendments,
		// デモ（store）は 1 室だけ
		rooms: [] as Awaited<ReturnType<typeof multiRoomCards>>,
		multiRoom: false,
		amend: { ...amendGate(booking.status, booking.checkin, amendments.length), datesOnly: false },
		plan: planById(booking.planId)!,
		room: roomTypeById(booking.roomTypeId)!,
		cancelPreview:
			booking.status === 'reserved'
				? computeCancelFee(params.code, today, booking.memberId)
				: null,
		refundPreview: null,
		// デモ（store）は早期決済割（discount）だけ
		prepayBonus: null
	};
};

export const actions: Actions = {
	cancel: async (event) => {
		const { params, locals } = event;

		if (MEMBER_SUPABASE) {
			// 2 室以上の予約の「すべてのお部屋を取り消す」（生きている部屋をまとめて。1 室ずつは ?/cancelRoom）
			try {
				// 所有者チェック・キャンセル料・ポイント巻き戻しは cancel_booking RPC が実施
				await sbCancelBookingAsMember(createSupabaseServerClient(event), params.code);
			} catch {
				return fail(400, { message: m.error_cannot_cancel() });
			}
			// オンライン決済済みなら「支払額 − キャンセル料」をカードへ返金（v0.43.0）
			const refund = await refundAfterCancel(params.code, 'member').catch(() => ({ kind: 'none' as const }));
			return { cancelled: true, refund };
		}

		const booking = bookings.get(params.code);
		if (!booking || booking.memberId !== locals.user!.id) return fail(404, { message: m.error_booking_not_found() });
		const result = cancelBooking(params.code);
		if ('error' in result) return fail(400, { message: m.error_cannot_cancel() });
		return { cancelled: true };
	},

	// 1 室だけの取消（2 室以上の予約・M2）。最後の 1 室なら予約全体の取消になる（DB 側で切り替わる）
	cancelRoom: async (event) => {
		const { request, params } = event;
		const form = await request.formData();
		const roomIndex = Number(form.get('roomIndex'));
		if (!Number.isInteger(roomIndex) || roomIndex < 1) return fail(400, { message: m.error_cannot_cancel() });
		if (!MEMBER_SUPABASE) return fail(400, { message: m.error_cannot_cancel() });
		let res;
		try {
			res = await sbCancelBookingRoomAsMember(createSupabaseServerClient(event), params.code, roomIndex);
		} catch {
			return fail(400, { message: m.error_cannot_cancel() });
		}
		// オンライン決済済みなら、この部屋の分（支払分 − 返金しない額）をカードへ返金
		const refund = await refundAfterCancel(params.code, 'member', { roomIndex }).catch(() => ({ kind: 'none' as const }));
		return {
			roomCancelled: { index: roomIndex, fee: res.cancellation_fee, bookingCancelled: res.booking_cancelled },
			cancelled: res.booking_cancelled,
			refund
		};
	},

	// オプション（滞在アレンジ）明細の取消（本人・提供日前日まで）
	cancelOption: async (event) => {
		const { request, params, locals } = event;
		const form = await request.formData();
		const orderId = String(form.get('orderId') ?? '');
		if (!orderId) return fail(400, { message: m.options_cancel_failed() });

		if (MEMBER_SUPABASE) {
			try {
				await sbCancelBookingOption(createSupabaseServerClient(event), orderId);
			} catch {
				return fail(400, { message: m.options_cancel_failed() });
			}
			return { optionCancelled: true };
		}

		const booking = bookings.get(params.code);
		if (!booking || booking.memberId !== locals.user!.id) return fail(404, { message: m.error_booking_not_found() });
		try {
			cancelBookingOption(orderId, locals.user!.id);
		} catch {
			return fail(400, { message: m.options_cancel_failed() });
		}
		return { optionCancelled: true };
	}
};
