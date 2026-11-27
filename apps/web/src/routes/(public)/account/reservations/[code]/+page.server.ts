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
	sbCancelBookingOption,
	reverseFacilityUuid
} from '$lib/server/supabase-data';
import { addDays } from '@autumn-book/core';
import { todayStr } from '$lib/format';
import * as m from '$lib/paraglide/messages';
import { refundAfterCancel, directPaymentForBooking } from '$lib/server/direct-payments';
import { bookingReceiptAvailable } from '$lib/booking-receipt';
import { bookingReceiptDefaultAddressee } from '$lib/server/booking-receipt';
import { amendGate, multiRoomCards, reservationDetailOf } from '$lib/server/member-reservation-detail';
import { memberPageCancelBooking, memberPageCancelBookingRoom, memberPageOpError } from '$lib/server/partners/member-bookings';
import { privateBookCanChange, privateBookReservationOf } from '$lib/server/private-book-bookings';
import { PRIVATE_BOOK_FORBIDDEN_MESSAGE, privateBookRouteOf } from '$lib/private-book-booking';
import { bathPmsEnabled } from '$lib/server/bath-pms-switch';
import type { Actions, PageServerLoad } from './$types';

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
		// プライベートブック（専用ページ経由）の予約も公式マイページから取消・変更・アレンジができる（docs/private-book.md「マイページ（予約後）」）。
		// 日程・お部屋の変更とアレンジは今ページを使える方だけ（対象から外れた方は取消だけ）
		const route = privateBookRouteOf(r, locals.user?.id);
		const privateBook = route.kind !== 'general';
		const canChange = route.kind === 'general' ? true : route.kind === 'private_book' ? await privateBookCanChange(route.who, r.facilityUuid) : false;
		// 部屋カードの「このお部屋を変更」（M3）: 一般の予約は 2 室以上（1 室は従来の変更ウィザード）・プライベートブックは室数を問わず（B面と同じ）
		const detail = await reservationDetailOf(
			event,
			client,
			r,
			canChange
				? { roomAmend: { scope: privateBook ? 'all' : 'multi', hrefOf: (i) => `/account/reservations/${r.code}/amend/room/${i}` } }
				: {}
		);
		// 領収書（カードのオンライン決済が済み、全額返金していない予約だけ・2026-11-21）
		const pay = r.payment !== 'onsite' ? await directPaymentForBooking(r.code).catch(() => null) : null;
		const receipt = bookingReceiptAvailable(pay) ? { href: `/account/reservations/${r.code}/receipt`, addressee: bookingReceiptDefaultAddressee(r) } : null;
		return {
			receipt,
			...detail,
			facility,
			// 専用ページへのリンクは出さない（操作はこの画面から）
			memberPage: detail.memberPage ? { ...detail.memberPage, href: null as string | null } : null,
			canPrebookBath: bathPmsEnabled() && r.status === 'reserved' && !detail.memberPage,
			readOnly: false,
			// プライベートブックの予約: 日程・お部屋の変更とアレンジを出すか（取消は対象から外れた方も出す）。
			// 日程変更はカードで払った予約では出さない（B面と同じ・変更の画面でも断る）
			privateBookChange: privateBook ? canChange : null,
			canAmend: privateBook ? canChange && detail.amend.canAmend && r.payment === 'onsite' : undefined
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
		// デモ（store）は部屋の変更（M3）を出さない
		roomAmend: [] as Awaited<ReturnType<typeof reservationDetailOf>>['roomAmend'],
		prepaidOnline: false,
		// デモ（store）には特別会員の専用ページ経由の予約は無い
		memberPerks: null,
		memberPage: null as (Awaited<ReturnType<typeof reservationDetailOf>>['memberPage'] & { href: string | null }) | null,
		readOnly: false,
		privateBookChange: null as boolean | null,
		canAmend: undefined as boolean | undefined,
		canPrebookBath: false,
		plan: planById(booking.planId)!,
		room: roomTypeById(booking.roomTypeId)!,
		cancelPreview:
			booking.status === 'reserved'
				? computeCancelFee(params.code, today, booking.memberId)
				: null,
		refundPreview: null,
		// デモ（store）は早期決済割（discount）だけ
		prepayBonus: null,
		// デモ（store）はオンライン決済が無いので領収書も出さない
		receipt: null as { href: string; addressee: string } | null
	};
};

export const actions: Actions = {
	cancel: async (event) => {
		const { params, locals } = event;

		if (MEMBER_SUPABASE) {
			const found = await privateBookReservationOf(event, params.code).catch(() => null);
			if (found && found.route.kind === 'deny') return fail(403, { code: 'forbidden', message: PRIVATE_BOOK_FORBIDDEN_MESSAGE });
			if (found?.route.kind === 'private_book') {
				// プライベートブック: 専用ページの入口（予約した本人を DB が確かめる・対象から外れた方も取り消せる）。文言は B面と同じ
				try {
					await memberPageCancelBooking(found.route.who);
				} catch (e) {
					const err = memberPageOpError(e);
					return fail(err.status, { code: err.code, message: err.message });
				}
				const refund = await refundAfterCancel(params.code, 'member').catch(() => ({ kind: 'none' as const }));
				return { cancelled: true, refund };
			}
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
		const found = await privateBookReservationOf(event, params.code).catch(() => null);
		if (found && found.route.kind === 'deny') return fail(403, { code: 'forbidden', message: PRIVATE_BOOK_FORBIDDEN_MESSAGE });
		let res;
		try {
			res =
				found?.route.kind === 'private_book'
					? await memberPageCancelBookingRoom(found.route.who, roomIndex)
					: await sbCancelBookingRoomAsMember(createSupabaseServerClient(event), params.code, roomIndex);
		} catch (e) {
			if (found?.route.kind === 'private_book') {
				const err = memberPageOpError(e);
				return fail(err.status, { code: err.code, message: err.message });
			}
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

	// オプション（滞在アレンジ）明細の取消（本人・提供日前日まで）。
	// プライベートブックの予約も同じ RPC（cancel_booking_option は専用ページのガードの対象外・B面と同じ）
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
