// 予約の詳細と操作（取消・メール再送・取消リンク再発行）。
// 本番（ADMIN_SUPABASE）は book の実データ、それ以外は store.ts のデモ。
//
// 設計書: docs/BOOKING_CANCEL_MAIL.md §5.3
//
// 取り消しは PMS ではなくここで行う。core.stays を cancelled にすると PMS 側の
// stays_release_rooms_on_cancel トリガーが走り、部屋割りが自動で解放される。
import { error, fail } from '@sveltejs/kit';

import { todayStr } from '$lib/format';
import {
	adminBookingDetail,
	adminCancelBooking,
	adminResendBookingMail,
	adminRotateCancelToken,
	bookAdmin,
	mapRpcError,
	type BookingDetail
} from '$lib/server/admin-app-data';
import { ADMIN_SUPABASE } from '$lib/server/auth';
import {
	bookings,
	cancelBooking,
	computeCancelFee,
	facilityById,
	planById,
	roomTypeById
} from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

const UNAVAILABLE = 'この環境では利用できません（DATA_SOURCE / AUTH_MODE が supabase ではありません）。';

function requireAdmin(role: string | undefined, what: string): string | null {
	if (role !== 'admin') return `${what}は管理者のみ行えます（スタッフは閲覧のみ）。`;
	return null;
}

export const load: PageServerLoad = async (event) => {
	const isAdmin = event.locals.user?.role === 'admin';

	if (ADMIN_SUPABASE) {
		let detail: BookingDetail;
		try {
			detail = await adminBookingDetail(bookAdmin(event), event.params.code);
		} catch (e) {
			const msg = mapRpcError(e);
			if (msg.includes('見つかりません')) error(404, '予約が見つかりません');
			error(500, msg);
		}
		return {
			live: true as const,
			canOperate: isAdmin,
			detail,
			// 直販（booking.bookings 行がある）のときだけ操作できる
			isDirect: detail.booking.booking_id !== null,
			feePreview: detail.booking.stay_status === 'reserved' ? (detail.cancel_policy.fee ?? 0) : null
		};
	}

	const booking = bookings.get(event.params.code);
	if (!booking) error(404, '予約が見つかりません');
	const isStaff = event.locals.user?.role === 'staff';
	const facility = facilityById(booking.facilityId)!;
	const room = roomTypeById(booking.roomTypeId)!;
	const plan = planById(booking.planId)!;

	// demo も実データと同じ形にして、画面テンプレートを1本に保つ
	const detail: BookingDetail = {
		booking: {
			code: booking.code,
			stay_id: booking.code,
			booking_id: booking.code,
			facility_id: booking.facilityId,
			facility_name: facility.name,
			source: booking.channel === 'ota' ? 'ota' : 'autumn_booking',
			channel_code: booking.channel,
			client: booking.channel === 'ota' ? null : 'web',
			check_in_date: booking.checkin,
			check_out_date: booking.checkin,
			nights: booking.nights,
			adult_count: booking.adults,
			room_name: room.name,
			plan_name: plan.name,
			total_amount: booking.total,
			discount: booking.discountAmount ?? 0,
			coupon_name: null,
			points_used: booking.pointsUsed,
			points_earned: booking.pointsEarned,
			price_lines: [],
			stay_status: booking.status,
			booking_status: booking.status,
			payment_status: booking.paymentStatus,
			cancellation_fee: booking.cancelFee ?? null,
			cancelled_at: null,
			cancelled_by: null,
			is_member: !!booking.memberId,
			member_user_id: booking.memberId ?? null,
			notes: null,
			created_at: booking.createdAt,
			amendments: 0
		},
		guest: {
			name: booking.guest.name,
			kana: booking.guest.kana,
			phone: isStaff ? '***-****-****' : booking.guest.phone,
			email: isStaff ? '（権限がありません）' : booking.guest.email,
			arrival: booking.guest.arrival ?? null,
			shuttle: booking.guest.shuttle ?? false,
			guest_notes: booking.guest.notes ?? null
		},
		cancel_policy: {
			rules_source: 'plan',
			rules: booking.cancellationPolicy.rules,
			fee: computeCancelFee(event.params.code, todayStr())?.fee ?? 0,
			rate: computeCancelFee(event.params.code, todayStr())?.rate ?? 0
		},
		mails: [],
		cancel_token: null,
		audits: []
	};

	return {
		live: false as const,
		canOperate: event.locals.user?.role === 'admin',
		detail,
		isDirect: booking.channel !== 'ota',
		feePreview: booking.status === 'reserved' ? (detail.cancel_policy.fee ?? 0) : null
	};
};

export const actions: Actions = {
	cancel: async (event) => {
		const denied = requireAdmin(event.locals.user?.role, 'ご予約の取り消し');
		if (denied) return fail(403, { message: denied });

		const form = await event.request.formData();
		const waive = form.get('waive') === 'on';
		const reason = String(form.get('reason') ?? '').trim();
		if (!reason) {
			return fail(400, { message: 'キャンセル理由を入力してください（監査ログに記録されます）' });
		}

		if (ADMIN_SUPABASE) {
			try {
				const res = await adminCancelBooking(bookAdmin(event), event.params.code, waive, reason);
				return { cancelled: true as const, fee: res.cancellation_fee };
			} catch (e) {
				return fail(400, { message: mapRpcError(e) });
			}
		}

		const result = cancelBooking(event.params.code, {
			waiveFee: waive,
			actor: event.locals.user!.name,
			reason
		});
		if ('error' in result) return fail(400, { message: 'この予約はキャンセルできません' });
		return { cancelled: true as const, fee: result.cancelFee ?? 0 };
	},

	/**
	 * 予約確認メールの再送。
	 * 送信済みの場合、取消リンクは新しいものに切り替わる（旧リンクは無効になる）。
	 * raw トークンは送信後に消しているため、同じリンクでは送り直せない。
	 */
	resend: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		const denied = requireAdmin(event.locals.user?.role, 'メールの再送');
		if (denied) return fail(403, { message: denied });
		try {
			await adminResendBookingMail(bookAdmin(event), event.params.code);
			return { resent: true as const };
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
	},

	/** 取消リンクの漏洩が疑われるときの明示操作。旧リンクを失効させ、新リンクで再送する。 */
	rotateToken: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		const denied = requireAdmin(event.locals.user?.role, '取り消しリンクの再発行');
		if (denied) return fail(403, { message: denied });
		try {
			await adminRotateCancelToken(bookAdmin(event), event.params.code);
			return { rotated: true as const };
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
	}
};
