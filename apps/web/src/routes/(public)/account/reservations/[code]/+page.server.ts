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
import type { BookingRoom } from '$lib/multi-room';
import { todayStr } from '$lib/format';
import * as m from '$lib/paraglide/messages';
import { directPaymentForBooking, directRefundPreviewOf, prepayBonusPointsOf, refundAfterCancel } from '$lib/server/direct-payments';
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

/** 複数室の予約の部屋ごとのカード（部屋名・プラン名・人数・金額・状態） */
async function multiRoomCards(rooms: BookingRoom[]) {
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
		cancelled: x.cancelled
	}));
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
		// 取り消したときの返金の見込み（予約時決済の割引額は返金しない）
		const refundPreview = cancelPreview && pay && pay.status === 'paid' ? directRefundPreviewOf(pay, cancelPreview.fee) : null;
		// 早期決済ポイント（施設が points のときの予約）。取消された予約には付与されないので出さない
		const bonusPoints = pay && pay.status === 'paid' && r.status !== 'cancelled' ? prepayBonusPointsOf(pay) : 0;
		const prepayBonus = bonusPoints > 0 ? { points: bonusPoints, granted: !!pay?.prepay_bonus_granted_at } : null;
		// 複数室（M1）: 部屋ごとのカード。取消は全室まとめて（2026-10-10 決定）。1 室ずつの取消・日程変更は M2 までお電話で
		const multiRoom = (r.rooms?.length ?? 0) > 1;
		const rooms = multiRoom ? await multiRoomCards(r.rooms ?? []) : [];
		return {
			booking: multiRoom ? { ...booking, adults: rooms.reduce((s, x) => s + x.adults, 0) } : booking,
			facility,
			checkout: r.checkout,
			options,
			amendments,
			rooms,
			multiRoom,
			amend: multiRoom ? { remaining: 0, deadlinePassed: false, canAmend: false } : amendGate(r.status, r.checkin, amendments.length),
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
		amend: amendGate(booking.status, booking.checkin, amendments.length),
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
			// 2 室以上の予約は全室まとめての取消（2026-10-10 決定。1 室ずつの取消は M2。キャンセル料・返金・ポイントは全室分）
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
