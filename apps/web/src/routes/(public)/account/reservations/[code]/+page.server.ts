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
import { refundAfterCancel } from '$lib/server/direct-payments';
import {
	amendGate,
	MEMBER_PAGE_BOOKING_MESSAGE,
	memberPageBookingOf,
	multiRoomCards,
	reservationDetailOf
} from '$lib/server/member-reservation-detail';
import { memberPageHrefFor } from '$lib/server/partners/member-bookings';
import type { SupabaseClient } from '@supabase/supabase-js';
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
		const detail = await reservationDetailOf(event, client, r);
		// 特別会員の専用ページ経由の予約は参照のみ（取消・日程変更・オプションは専用ページのご予約一覧から・docs/vip-member-page.md §13.4.4）
		const memberPageHref = detail.memberPage ? await memberPageHrefFor(detail.memberPage.partnerId, r.code).catch(() => null) : null;
		return {
			...detail,
			facility,
			memberPage: detail.memberPage ? { ...detail.memberPage, href: memberPageHref } : null,
			readOnly: !!detail.memberPage
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
		// デモ（store）には特別会員の専用ページ経由の予約は無い
		memberPerks: null,
		memberPage: null as (Awaited<ReturnType<typeof reservationDetailOf>>['memberPage'] & { href: string | null }) | null,
		readOnly: false,
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

/**
 * 特別会員の専用ページ経由の予約は、公式マイページからは取消・日程変更・オプションをさせない（参照のみ・§13.4.4）。
 * DB のガード（book._member_page_guard）でも止まるが、案内の文言を返すためにここで先に断る。該当すれば fail、無ければ null
 */
async function denyMemberPageBooking(client: SupabaseClient, code: string) {
	const mp = await memberPageBookingOf(client, code);
	return mp ? fail(403, { code: 'member_page_booking' as const, message: MEMBER_PAGE_BOOKING_MESSAGE, href: mp.href }) : null;
}

export const actions: Actions = {
	cancel: async (event) => {
		const { params, locals } = event;

		if (MEMBER_SUPABASE) {
			const denied = await denyMemberPageBooking(createSupabaseServerClient(event), params.code);
			if (denied) return denied;
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
		const denied = await denyMemberPageBooking(createSupabaseServerClient(event), params.code);
		if (denied) return denied;
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
			const denied = await denyMemberPageBooking(createSupabaseServerClient(event), params.code);
			if (denied) return denied;
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
