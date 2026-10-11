// 予約の詳細と操作（取消・メール再送・取消リンク再発行）。
// 本番（ADMIN_SUPABASE）は book の実データ、それ以外は store.ts のデモ。
//
// 設計書: docs/BOOKING_CANCEL_MAIL.md §5.3
//
// 取り消しは PMS ではなくここで行う。core.stays を cancelled にすると PMS 側の
// stays_release_rooms_on_cancel トリガーが走り、部屋割りが自動で解放される。
//
// 取引先予約（source='rms_partner'・限定URL /p/<token> から入った予約）は booking.bookings 行があるが直販ではない。
// book 側の操作（取消・返金・メール再送・取消リンク・会員紐づけ）は台帳・Stripe 返金・取引先メールを通らず、
// 宿泊者へメールが出てしまうため、全 action の入口で rejectPartner により拒否する。
// 取引先予約の取消・再請求は partnerCancel / partnerRetryCharge（/admin/partners/[id] と同じ関数・同じ権限）で行う。
import { parseStaffFeeForm } from '$lib/server/partners/booking';
import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';

import { todayStr } from '$lib/format';
import {
	adminBookingDetail,
	adminCancelBooking,
	adminCancelBookingRoom,
	adminFindMembers,
	adminLinkBookingMember,
	linkMemberErrorText,
	adminResendBookingMail,
	adminRotateCancelToken,
	adminAmendBookingRooms,
	adminQuoteAmendRooms,
	bookAdmin,
	mapRpcError,
	type BookingDetail
} from '$lib/server/admin-app-data';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { registerMemberForBooking } from '$lib/server/staff-member-register';
import {
	bookings,
	cancelBooking,
	computeCancelFee,
	facilityById,
	planById,
	roomTypeById
} from '$lib/server/store';
import {
	directPaymentForBooking,
	directRefundDueFor,
	setDirectAdminFeeWaived,
	refundAfterCancel,
	retryDirectRefund,
	type DirectRefundOutcome
} from '$lib/server/direct-payments';
import {
	isPartnerReservationCode,
	isPartnerStay,
	partnerFirstRoomCode,
	PARTNER_BOOK_ACTION_DENIED
} from '$lib/partner-reservation';
import {
	cancelPartnerReservation,
	loadPartnerLedgerForReservation,
	retryPartnerReservationCharge,
	type PartnerLedgerResult
} from '$lib/server/partners/admin-reservations';
import { actionFailure } from '$lib/server/partners/staff';
import { todayJst } from '$lib/server/partners/store';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { loadMemberPagePlans } from '$lib/server/partners/member-hold';
import { staffMemberAmendRoomInput } from '$lib/server/partners/member-bookings';
import { sbListPlansMapped, sbListRoomTypesMapped } from '$lib/server/supabase-data';
import {
	AMEND_ROOM_MESSAGES_JA,
	amendLimitOf,
	amendRoomErrorCode,
	amendRoomErrorStatus,
	parseAdults,
	type AmendRoomInput
} from '$lib/multi-room';
import type { DirectPaymentInfo } from '$lib/server/direct-payments';
import type { Actions, PageServerLoad } from './$types';

const UNAVAILABLE = 'この環境では利用できません（DATA_SOURCE / AUTH_MODE が supabase ではありません）。';

function requireAdmin(role: string | undefined, what: string): string | null {
	if (role !== 'admin') return `${what}は管理者のみ行えます（スタッフは閲覧のみ）。`;
	return null;
}

/**
 * 取引先予約なら book 側の操作を拒否する（サーバ側のガード）。取引先予約でなければ null。
 * 予約番号の形（PB-…）で先に弾き、それ以外も admin_booking_detail の source / channel_code で確かめる。
 * memberScope: 会員まわりの action は失敗表示の置き場所が違うので、その形で返す。
 */
async function rejectPartner(event: RequestEvent, memberScope = false) {
	const deny = (status: number, message: string) =>
		memberScope ? fail(status, { memberScope: true, memberError: message }) : fail(status, { message });
	const code = event.params.code ?? '';
	if (isPartnerReservationCode(code)) return deny(409, PARTNER_BOOK_ACTION_DENIED);
	// デモ（store.ts）には取引先予約が無い（経路は autumn_booking / ota のみ）ので、番号の形だけで足りる
	if (!ADMIN_SUPABASE) return null;
	try {
		const detail = await adminBookingDetail(bookAdmin(event), code);
		if (isPartnerStay(detail.booking)) return deny(409, PARTNER_BOOK_ACTION_DENIED);
	} catch (e) {
		return deny(400, mapRpcError(e));
	}
	return null;
}

const NO_PARTNER: PartnerLedgerResult = { ledger: null, error: null };

// ---------------------------------------------------------------- 部屋ごとの部屋タイプ・プラン・人数の変更（公式の複数室 M3・§17.3.3）

/** 部屋の変更の可否（予約全体）と選択肢。B は rooms[i].canAmend と amendOptions を使う */
type AmendRoomsState = {
	/** 予約全体として変えられるか（直販・confirmed・全室 reserved・オンライン決済済みでない・回数が残る）。締切・ペナルティは force で越えられるので見ない */
	ok: boolean;
	remaining: number;
	limit: number;
	prepaidOnline: boolean;
	/** 専用ページ経由（料金は専用料金。専用ページで扱っていないプランは選べない） */
	memberPage: boolean;
};
type AmendOptions = {
	roomTypes: { id: string; name: string; capacity: number }[];
	/** onsite: 会員の現地払いを許すプラン（false のプランは選べない）。memberPage: 専用ページで扱うプラン（専用ページ経由の予約では false は選べない） */
	plans: { id: string; name: string; onsite: boolean; memberPage: boolean }[];
};
const NO_AMEND: { amendRooms: AmendRoomsState; amendOptions: AmendOptions } = {
	amendRooms: { ok: false, remaining: 0, limit: 2, prepaidOnline: false, memberPage: false },
	amendOptions: { roomTypes: [], plans: [] }
};

const PREPAID_ADMIN_MESSAGE =
	'カードでお支払い済みのご予約は、お部屋・プラン・人数を変更できません。取消 → 取り直し（キャンセル料がかからない期間なら全額返金）でご案内ください。';

/** 部屋の変更の可否を detail.booking.rooms[i].canAmend に書き、選択肢（施設の部屋タイプ・公開プラン）を読む */
async function amendRoomsOf(detail: BookingDetail, payment: DirectPaymentInfo | null) {
	const b = detail.booking;
	const rooms = b.rooms ?? [];
	const live = rooms.filter((r) => !r.cancelled);
	const prepaidOnline = payment?.status === 'paid' && payment.refund_status !== 'full';
	const limit = amendLimitOf(Math.max(1, rooms.length));
	const remaining = Math.max(0, limit - (b.amendments ?? 0));
	const ok =
		b.booking_id !== null &&
		b.booking_status === 'confirmed' &&
		!prepaidOnline &&
		remaining > 0 &&
		live.length > 0 &&
		live.every((r) => r.stay_status === 'reserved');
	for (const r of rooms) r.canAmend = ok && !r.cancelled;
	const state: AmendRoomsState = { ok, remaining, limit, prepaidOnline, memberPage: !!b.memberPage };
	if (!ok) return { amendRooms: state, amendOptions: NO_AMEND.amendOptions };
	const sb = b.memberPage ? partnerServiceClient() : null;
	const [roomTypes, plans, memberPlans] = await Promise.all([
		sbListRoomTypesMapped(b.facility_id).catch(() => []),
		sbListPlansMapped(b.facility_id).catch(() => []),
		sb ? loadMemberPagePlans(sb, b.facility_id).catch(() => null) : Promise.resolve(null)
	]);
	const memberIds = memberPlans ? new Set([...memberPlans.values()].map((p) => p.ratePlanId)) : null;
	return {
		amendRooms: state,
		amendOptions: {
			roomTypes: roomTypes.map((t) => ({ id: t.id, name: t.name, capacity: t.capacity })),
			plans: plans.map((p) => ({ id: p.id, name: p.name, onsite: p.payment.onsite, memberPage: memberIds ? memberIds.has(p.id) : true }))
		}
	};
}

/** フォーム（roomIndex・ratePlanId・roomTypeId・adults）→ RPC の入力。専用ページ経由の予約は専用料金の泊明細と特典を付ける */
async function adminRoomInput(
	event: RequestEvent,
	form: FormData
): Promise<{ ok: true; input: AmendRoomInput; roomIndex: number } | { ok: false; status: number; message: string }> {
	const roomIndex = Number(form.get('roomIndex'));
	const ratePlanId = String(form.get('ratePlanId') ?? '');
	const roomTypeId = String(form.get('roomTypeId') ?? '');
	const adults = parseAdults(form.get('adults'));
	if (!Number.isInteger(roomIndex) || roomIndex < 1 || !ratePlanId || !roomTypeId || adults === null) {
		return { ok: false, status: 400, message: '変更するお部屋・部屋タイプ・プラン・人数（1〜6 名）を選んでください。' };
	}
	let detail: BookingDetail;
	try {
		detail = await adminBookingDetail(bookAdmin(event), event.params.code ?? '');
	} catch (e) {
		return { ok: false, status: 400, message: mapRpcError(e) };
	}
	const b = detail.booking;
	if (!b.memberPage) return { ok: true, roomIndex, input: { index: roomIndex, ratePlanId, roomTypeId, adults } };
	const built = await staffMemberAmendRoomInput({
		partnerId: b.memberPage.partnerId,
		facilityId: b.facility_id,
		bookingCode: b.code,
		checkIn: b.check_in_date,
		nights: b.nights,
		rooms: (b.rooms ?? []).map((r) => ({
			index: r.room_index,
			cancelled: r.cancelled,
			stayStatus: r.stay_status,
			adults: r.adults,
			roomTypeId: r.room_type_id ?? '',
			ratePlanId: r.rate_plan_id ?? '',
			roomTotal: r.room_total
		})),
		roomIndex,
		change: { ratePlanId, roomTypeId, adults }
	}).catch((e) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }));
	if (!built.ok) return { ok: false, status: 400, message: built.message };
	return { ok: true, roomIndex, input: built.input };
}

/** 部屋の変更の DB の例外 → 管理画面の文言 */
function amendRoomFailure(e: unknown) {
	const code = amendRoomErrorCode(e);
	const message =
		code === 'prepaid_online'
			? PREPAID_ADMIN_MESSAGE
			: code === 'forbidden' || code === 'error'
				? mapRpcError(e)
				: AMEND_ROOM_MESSAGES_JA[code];
	return fail(amendRoomErrorStatus(code), { amendRoomError: message, amendRoomCode: code });
}

export const load: PageServerLoad = async (event) => {
	const isAdmin = event.locals.user?.role === 'admin';

	if (ADMIN_SUPABASE) {
		let detail: BookingDetail | null = null;
		try {
			detail = await adminBookingDetail(bookAdmin(event), event.params.code);
		} catch (e) {
			const msg = mapRpcError(e);
			if (!msg.includes('見つかりません')) error(500, msg);
		}
		if (!detail) {
			// 複数室の取引先予約は滞在が PB-…-1, -2 …。一覧（metadata.booking_code）から台帳番号で来たら1室目へ
			const firstRoom = partnerFirstRoomCode(event.params.code);
			if (firstRoom) redirect(303, `/admin/reservations/${encodeURIComponent(firstRoom)}`);
			error(404, '予約が見つかりません');
		}

		// 取引先予約: book 側の操作は出さず、台帳（取引先名・予約者・支払状況）と取引先予約としての取消を出す
		if (isPartnerStay(detail.booking)) {
			return {
				live: true as const,
				canOperate: isAdmin,
				detail,
				payment: null,
				refundDue: null,
				isDirect: false,
				isPartner: true,
				partner: await loadPartnerLedgerForReservation(event, event.params.code),
				today: todayJst(),
				feePreview: null,
				...NO_AMEND
			};
		}

		// オンライン決済（公式サイト予約・v0.43.0）の台帳。現地払い・未適用の環境は null
		const payment = detail.booking.booking_id ? await directPaymentForBooking(event.params.code).catch(() => null) : null;
		// 取消済みのオンライン決済: 返金の内訳（規定のキャンセル料・返金しない予約時決済の割引額）を DB から。
		// 1 室だけ取り消した予約（M2）も、取り消した部屋の分の返金の内訳を出す
		const someRoomCancelled = (detail.booking.rooms ?? []).some((r) => r.cancelled);
		const refundDue =
			payment?.status === 'paid' && (detail.booking.booking_status === 'cancelled' || someRoomCancelled)
				? await directRefundDueFor(event.params.code).catch(() => null)
				: null;
		return {
			live: true as const,
			canOperate: isAdmin,
			detail,
			payment,
			refundDue,
			// 直販（booking.bookings 行がある）のときだけ操作できる
			isDirect: detail.booking.booking_id !== null,
			isPartner: false,
			partner: NO_PARTNER,
			today: todayJst(),
			// 2 室以上は代表の 1 室目を取り消していても、生きている部屋があれば取り消せる（M2）
			feePreview:
				detail.booking.stay_status === 'reserved' ||
				(detail.booking.booking_status !== 'cancelled' && (detail.booking.rooms ?? []).some((r) => !r.cancelled && r.stay_status === 'reserved'))
					? (detail.cancel_policy.fee ?? 0)
					: null,
			// 部屋ごとの部屋タイプ・プラン・人数の変更（M3）: detail.booking.rooms[i].canAmend・amendRooms・amendOptions
			...(await amendRoomsOf(detail, payment))
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
		payment: null,
		refundDue: null,
		isDirect: booking.channel !== 'ota',
		isPartner: false,
		partner: NO_PARTNER,
		today: todayJst(),
		feePreview: booking.status === 'reserved' ? (detail.cancel_policy.fee ?? 0) : null,
		// デモ（store）は部屋の変更（M3）を出さない
		...NO_AMEND
	};
};

export const actions: Actions = {
	/**
	 * 部屋の変更の見積（M3・admin / staff。テナント・施設の権限は DB の _require_staff / has_facility_access が確かめる）。
	 * 入力 roomIndex・ratePlanId・roomTypeId・adults → { roomQuote, roomIndex }／fail(status, { amendRoomError, amendRoomCode })
	 */
	quoteRoom: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { amendRoomError: UNAVAILABLE, amendRoomCode: 'invalid' });
		// 決定 M4: admin / staff とも可（施設の権限・実際の役割は DB の admin_*_rooms が確かめる）
		const role = event.locals.user?.role;
		if (role !== 'admin' && role !== 'staff') return fail(403, { amendRoomError: '権限がありません。', amendRoomCode: 'forbidden' });
		const partnerDenied = await rejectPartner(event);
		if (partnerDenied) return partnerDenied;
		const built = await adminRoomInput(event, await event.request.formData());
		if (!built.ok) return fail(built.status, { amendRoomError: built.message, amendRoomCode: 'invalid' });
		try {
			const roomQuote = await adminQuoteAmendRooms(bookAdmin(event), event.params.code, [built.input]);
			return { roomQuote, roomIndex: built.roomIndex };
		} catch (e) {
			return amendRoomFailure(e);
		}
	},

	/**
	 * 部屋の変更の確定（M3・理由必須・監査ログ amend_booking_rooms）。force=on でキャンセル料がかかる期間・締切後でも変える
	 * （回数とオンライン決済済みは越えない）。入力 roomIndex・ratePlanId・roomTypeId・adults・reason・force
	 * → { amended: { roomIndex, amendmentNo, kind, diff, newTotal, pointsRefund, forced, changed } }
	 */
	amendRoom: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { amendRoomError: UNAVAILABLE, amendRoomCode: 'invalid' });
		// 決定 M4: admin / staff とも可（施設の権限・実際の役割は DB の admin_*_rooms が確かめる）
		const role = event.locals.user?.role;
		if (role !== 'admin' && role !== 'staff') return fail(403, { amendRoomError: '権限がありません。', amendRoomCode: 'forbidden' });
		const partnerDenied = await rejectPartner(event);
		if (partnerDenied) return partnerDenied;
		const form = await event.request.formData();
		const reason = String(form.get('reason') ?? '').trim();
		if (!reason) return fail(400, { amendRoomError: '変更の理由を入力してください（監査ログに記録されます）。', amendRoomCode: 'reason_required' });
		const force = form.get('force') === 'on';
		const built = await adminRoomInput(event, form);
		if (!built.ok) return fail(built.status, { amendRoomError: built.message, amendRoomCode: 'invalid' });
		try {
			const res = await adminAmendBookingRooms(bookAdmin(event), event.params.code, [built.input], reason, force);
			return {
				amended: {
					roomIndex: built.roomIndex,
					amendmentNo: res.amendment_no,
					kind: res.kind,
					diff: res.diff,
					newTotal: res.new_total,
					pointsRefund: res.points_refund,
					forced: res.forced,
					changed: res.changed
				}
			};
		} catch (e) {
			return amendRoomFailure(e);
		}
	},

	cancel: async (event) => {
		const denied = requireAdmin(event.locals.user?.role, 'ご予約の取り消し');
		if (denied) return fail(403, { message: denied });
		const partnerDenied = await rejectPartner(event);
		if (partnerDenied) return partnerDenied;

		const form = await event.request.formData();
		const waive = form.get('waive') === 'on';
		// 取消の範囲: all（予約全体・既定）／room（この部屋だけ・複数室 M2）
		const scope = form.get('scope') === 'room' ? 'room' : 'all';
		const roomIndex = Number(form.get('roomIndex'));
		if (scope === 'room' && (!Number.isInteger(roomIndex) || roomIndex < 1)) {
			return fail(400, { message: '取り消すお部屋を選んでください。' });
		}
		// 事務手数料も免除する（既定は差し引く・キャンセル料の免除とは別・2026-10-07）
		const adminFeeWaive = form.get('adminFeeWaive') === 'on';
		const reason = String(form.get('reason') ?? '').trim();
		if (!reason) {
			return fail(400, { message: 'キャンセル理由を入力してください（監査ログに記録されます）' });
		}

		if (ADMIN_SUPABASE) {
			if (scope === 'room') {
				try {
					const res = await adminCancelBookingRoom(bookAdmin(event), event.params.code, roomIndex, waive, reason);
					if (adminFeeWaive) await setDirectAdminFeeWaived(event.params.code, true);
					// オンライン決済済みなら、この部屋の分（支払分 − 返金しない額）をカードへ返金
					const refund: DirectRefundOutcome = await refundAfterCancel(event.params.code, 'staff', { roomIndex }).catch(() => ({
						kind: 'none' as const
					}));
					return {
						cancelled: res.booking_cancelled,
						roomCancelled: { index: roomIndex, bookingCancelled: res.booking_cancelled },
						fee: res.cancellation_fee,
						refund
					};
				} catch (e) {
					return fail(400, { message: mapRpcError(e) });
				}
			}
			try {
				const res = await adminCancelBooking(bookAdmin(event), event.params.code, waive, reason);
				// 返金額の計算（DB の direct_payment_refund_due）より先に、事務手数料の免除を支払の記録に残す
				if (adminFeeWaive) await setDirectAdminFeeWaived(event.params.code, true);
				// オンライン決済済みなら「支払額 − キャンセル料（免除なら 0）」をカードへ返金
				const refund: DirectRefundOutcome = await refundAfterCancel(event.params.code, 'staff').catch(() => ({ kind: 'none' as const }));
				return { cancelled: true as const, fee: res.cancellation_fee, refund };
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

	/** 返金の再実行（取消済みで返金が失敗・未了のオンライン決済の予約）。管理者のみ */
	retryRefund: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		const denied = requireAdmin(event.locals.user?.role, '返金');
		if (denied) return fail(403, { message: denied });
		const partnerDenied = await rejectPartner(event);
		if (partnerDenied) return partnerDenied;
		// 施設・テナントの権限は既存 RPC で確かめる（見えない予約なら例外）
		try {
			await adminBookingDetail(bookAdmin(event), event.params.code);
		} catch (e) {
			return fail(403, { message: mapRpcError(e) });
		}
		const refund = await retryDirectRefund(event.params.code);
		if (refund.kind === 'failed') return fail(502, { message: `返金に失敗しました（${refund.message}）` });
		return { refundRetried: true as const, refund };
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
		const partnerDenied = await rejectPartner(event);
		if (partnerDenied) return partnerDenied;
		try {
			await adminResendBookingMail(bookAdmin(event), event.params.code);
			return { resent: true as const };
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
	},

	/**
	 * 非会員の予約を会員に紐づける（電話で「会員になりたい」と言われたとき）。スタッフも操作できる。
	 * findMember で候補を出し、linkMember で確定する。お客様にはまず会員登録（/auth/register）をしてもらう。
	 */
	findMember: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { memberScope: true, memberError: UNAVAILABLE });
		const role = event.locals.user?.role;
		if (role !== 'admin' && role !== 'staff') return fail(403, { memberScope: true, memberError: '権限がありません。' });
		const partnerDenied = await rejectPartner(event, true);
		if (partnerDenied) return partnerDenied;
		const q = String((await event.request.formData()).get('q') ?? '').trim();
		if (q.length < 3) {
			return fail(400, { memberScope: true, memberQuery: q, memberError: '会員番号・メールアドレス・電話番号を入れてください。' });
		}
		try {
			const found = (await adminFindMembers(bookAdmin(event), q)) ?? [];
			return { memberScope: true, memberQuery: q, candidates: found };
		} catch (e) {
			return fail(400, { memberScope: true, memberQuery: q, memberError: linkMemberErrorText(e) });
		}
	},
	/** 会員登録そのものを代行する（お客様の同意を電話で得たうえで）。スタッフも操作できる */
	registerMember: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { memberScope: true, memberError: UNAVAILABLE });
		const role = event.locals.user?.role;
		if (role !== 'admin' && role !== 'staff') return fail(403, { memberScope: true, memberError: '権限がありません。' });
		const partnerDenied = await rejectPartner(event, true);
		if (partnerDenied) return partnerDenied;
		const fd = await event.request.formData();
		if (fd.get('consent') !== 'on') {
			return fail(400, { memberScope: true, memberError: '会員登録についてお客様の同意を得たことを確認してください。' });
		}
		const email = String(fd.get('email') ?? '').trim();
		try {
			const detail = await adminBookingDetail(bookAdmin(event), event.params.code);
			const registered = await registerMemberForBooking({
				staffClient: createSupabaseServerClient(event),
				bookingCode: event.params.code,
				email,
				name: detail.guest.name,
				mailOptIn: fd.get('mailOptIn') === 'on',
				facilityName: detail.booking.facility_name,
				origin: event.url.origin
			});
			return { memberScope: true, registered };
		} catch (e) {
			return fail(400, { memberScope: true, memberError: e instanceof Error ? e.message : String(e) });
		}
	},
	linkMember: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { memberScope: true, memberError: UNAVAILABLE });
		const role = event.locals.user?.role;
		if (role !== 'admin' && role !== 'staff') return fail(403, { memberScope: true, memberError: '権限がありません。' });
		const partnerDenied = await rejectPartner(event, true);
		if (partnerDenied) return partnerDenied;
		const fd = await event.request.formData();
		const userId = String(fd.get('memberUserId') ?? '');
		if (!/^[0-9a-f-]{36}$/i.test(userId)) return fail(400, { memberScope: true, memberError: '会員を選んでください。' });
		try {
			const linked = await adminLinkBookingMember(bookAdmin(event), event.params.code, userId, fd.get('moveGuest') === 'on');
			return { memberScope: true, linked };
		} catch (e) {
			return fail(400, { memberScope: true, memberError: linkMemberErrorText(e) });
		}
	},

	/**
	 * 取引先予約の取消（管理者のみ）。/admin/partners/[id] の cancelBooking と同じ処理:
	 * staffPartnerScope('edit') → requireStaffPartner（施設の確認）→ cancelPartnerBooking(…, 'staff', …)。
	 * 台帳・PMS・オンライン決済の返金・取引先（予約者）へのメールまで行う。宿泊者へはメールしない。
	 */
	partnerCancel: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		const denied = requireAdmin(event.locals.user?.role, '取引先予約の取り消し');
		if (denied) return fail(403, { message: denied });
		try {
			// URL の予約が取引先予約であること（直販の予約番号で取引先の取消を走らせない）
			const detail = await adminBookingDetail(bookAdmin(event), event.params.code);
			if (!isPartnerStay(detail.booking)) return fail(400, { message: '取引先予約ではありません。' });
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
		const fd = await event.request.formData();
		const reason = String(fd.get('reason') ?? '').trim();
		if (!reason) return fail(400, { message: '取消の理由を入力してください（取引先の台帳に残ります）。' });
		try {
			const b = await cancelPartnerReservation(event, event.params.code, {
				reason,
				// オンライン決済済みの予約を返金するか（画面のチェック。既定は返金する）
				refund: fd.get('refund') !== null,
				...parseStaffFeeForm(fd)
			});
			return { partnerCancelled: b.booking_code, partnerPaymentStatus: b.payment_status };
		} catch (e) {
			return actionFailure(e);
		}
	},

	/** 取引先予約のチェックアウト日決済の再請求（管理者のみ）。/admin/partners/[id] の retryCharge と同じ処理 */
	partnerRetryCharge: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		const denied = requireAdmin(event.locals.user?.role, '再請求');
		if (denied) return fail(403, { message: denied });
		try {
			const detail = await adminBookingDetail(bookAdmin(event), event.params.code);
			if (!isPartnerStay(detail.booking)) return fail(400, { message: '取引先予約ではありません。' });
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
		try {
			const r = await retryPartnerReservationCharge(event, event.params.code);
			return { partnerCharge: r };
		} catch (e) {
			return actionFailure(e);
		}
	},

	/** 取消リンクの漏洩が疑われるときの明示操作。旧リンクを失効させ、新リンクで再送する。 */
	rotateToken: async (event) => {
		if (!ADMIN_SUPABASE) return fail(400, { message: UNAVAILABLE });
		const denied = requireAdmin(event.locals.user?.role, '取り消しリンクの再発行');
		if (denied) return fail(403, { message: denied });
		const partnerDenied = await rejectPartner(event);
		if (partnerDenied) return partnerDenied;
		try {
			await adminRotateCancelToken(bookAdmin(event), event.params.code);
			return { rotated: true as const };
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
	}
};
