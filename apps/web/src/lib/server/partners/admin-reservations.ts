// 予約管理（/admin/reservations）から取引先予約の台帳（public.rms_partner_bookings）を引くための入口。
//
// rms_partner_* は service_role 専用なので、必ず staffPartnerScope（ログイン中スタッフの施設アクセス確認）を
// 通してから触る。施設は管理画面で選んでいる施設（ab_fac）に限る＝台帳の facility_id がそれと一致する予約だけ。
// 取消・再請求は /admin/partners/[id] と同じ関数（cancelPartnerBooking / retryPartnerCharge）を使う。
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readBookingExtras } from './booking-extras';
import { describeBooker, chargeAmountOf } from '$lib/partner-booking';
import { partnerBookingCodeOf } from '$lib/partner-reservation';
import { cancelPartnerBooking, getPartnerBooking, retryPartnerCharge, type ChargeResult, type PartnerBookingRow } from './booking';
import { staffPartnerScope, StaffScopeError } from './staff';
import { PartnerStoreError, requireStaffPartner } from './store';

/** 予約管理の詳細に出す取引先予約の内容（宿泊者のメールは管理者のときだけ入れる） */
export type PartnerLedgerView = {
	id: string;
	partnerId: string | null;
	partnerName: string;
	bookingCode: string;
	status: PartnerBookingRow['status'];
	checkedIn: boolean;
	checkIn: string;
	nights: number;
	roomCount: number;
	adultTotal: number;
	roomName: string;
	planName: string;
	/** 予約したログインID */
	bookedBy: string | null;
	/** 予約者（取引先のご担当者）。2026-10-01 より前の予約には無い */
	booker: string | null;
	transport: string | null;
	perks: { title: string; description: string }[];
	paymentName: string | null;
	paymentOption: string | null;
	paymentStatus: string;
	cardLabel: string | null;
	chargeError: string | null;
	refundError: string | null;
	/** 宿泊料金（キャンセル料の基準） */
	lodging: number;
	bathTax: number;
	prepayDiscount: number;
	/** 請求額（宿泊料金＋入湯税−予約時決済の割引） */
	chargeAmount: number;
	paidAmount: number | null;
	paidAt: string | null;
	cancelledAt: string | null;
	cancelledBy: string | null;
	createdAt: string;
	/** 管理者のみ（スタッフには連絡先を見せない） */
	guestEmail: string | null;
};

export type PartnerLedgerResult = { ledger: PartnerLedgerView | null; error: string | null };

/** 台帳の行を、施設（facility_id）と booking_code で引く（見つからなければ null） */
async function findLedgerRow(db: SupabaseClient, facilityId: string, bookingCode: string): Promise<PartnerBookingRow | null> {
	const { data, error } = await db
		.from('rms_partner_bookings')
		.select('id, partner_id')
		.eq('booking_code', bookingCode)
		.eq('facility_id', facilityId)
		.maybeSingle();
	if (error) throw new PartnerStoreError(`取引先予約の台帳を読み込めませんでした（${error.message}）。`, 503);
	if (!data?.partner_id) return null;
	return getPartnerBooking(db, String(data.partner_id), String(data.id));
}

function toView(b: PartnerBookingRow, isAdmin: boolean): PartnerLedgerView {
	const x = readBookingExtras(b.detail);
	return {
		id: b.id,
		partnerId: b.partner_id,
		partnerName: b.partner_name,
		bookingCode: b.booking_code,
		status: b.status,
		checkedIn: !!b.checkedIn,
		checkIn: b.check_in_date,
		nights: b.nights,
		roomCount: b.room_count,
		adultTotal: b.adult_total,
		roomName: b.room_name ?? b.room_code ?? '',
		planName: b.plan_name ?? '',
		bookedBy: b.booked_by,
		booker: x.booker?.name ? describeBooker(x.booker) : null,
		transport: x.transport || null,
		perks: x.perks,
		paymentName: b.payment_method_name,
		paymentOption: b.payment_option,
		paymentStatus: b.payment_status,
		cardLabel: b.card_label,
		chargeError: b.charge_error,
		refundError: b.refund_error,
		lodging: b.total_amount,
		bathTax: b.bath_tax_amount ?? 0,
		prepayDiscount: b.prepay_discount_amount ?? 0,
		chargeAmount: chargeAmountOf(b),
		paidAmount: b.paid_amount,
		paidAt: b.paid_at,
		cancelledAt: b.cancelled_at,
		cancelledBy: b.cancelled_by,
		createdAt: b.created_at,
		guestEmail: isAdmin ? b.guest_email : null
	};
}

/**
 * 予約管理の詳細（取引先予約）に出す台帳。reservationCode は滞在の予約番号（PB-…、複数室は PB-…-N）。
 * 使えない環境・権限なし・別施設の予約は ledger: null と理由を返す（画面は落とさない）。
 */
export async function loadPartnerLedgerForReservation(event: RequestEvent, reservationCode: string): Promise<PartnerLedgerResult> {
	const code = partnerBookingCodeOf(reservationCode);
	if (!code) return { ledger: null, error: '取引先予約の予約番号の形ではないため、台帳を引けません。' };
	try {
		const scope = await staffPartnerScope(event, 'view');
		const row = await findLedgerRow(scope.db, scope.facilityId, code);
		if (!row) {
			return {
				ledger: null,
				error: `いま選んでいる施設（${scope.facilityName}）の取引先予約の台帳に ${code} が見つかりません。施設を切り替えてください。`
			};
		}
		return { ledger: toView(row, event.locals.user?.role === 'admin'), error: null };
	} catch (e) {
		if (e instanceof StaffScopeError || e instanceof PartnerStoreError) return { ledger: null, error: e.message };
		return { ledger: null, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * 予約管理の一覧で、取引先予約の行に取引先名を付けるための対応表（台帳の booking_code → 取引先名）。
 * いま選んでいる施設の台帳だけを見る。使えない環境・権限なしは空（一覧はチャネル名のまま出す）。
 */
export async function partnerNamesForCodes(event: RequestEvent, reservationCodes: string[]): Promise<Map<string, string>> {
	const codes = [...new Set(reservationCodes.map(partnerBookingCodeOf).filter((c): c is string => !!c))];
	const names = new Map<string, string>();
	if (!codes.length) return names;
	try {
		const scope = await staffPartnerScope(event, 'view');
		const { data, error } = await scope.db
			.from('rms_partner_bookings')
			.select('booking_code, partner_name')
			.eq('facility_id', scope.facilityId)
			.in('booking_code', codes);
		if (error) return names;
		for (const r of (data ?? []) as { booking_code: string; partner_name: string | null }[]) {
			if (r.partner_name) names.set(r.booking_code, r.partner_name);
		}
	} catch {
		// 取引先名は付加情報。取れなくても一覧は出す
	}
	return names;
}

/** 取消・再請求の共通: 管理者・施設・台帳・取引先の所属を確かめる（/admin/partners/[id] の editScope と同じ確認） */
async function partnerEditTarget(event: RequestEvent, reservationCode: string) {
	const code = partnerBookingCodeOf(reservationCode);
	if (!code) throw new PartnerStoreError('取引先予約ではありません。', 400);
	const scope = await staffPartnerScope(event, 'edit');
	const row = await findLedgerRow(scope.db, scope.facilityId, code);
	if (!row?.partner_id) {
		throw new PartnerStoreError(`いま選んでいる施設（${scope.facilityName}）の取引先予約に ${code} が見つかりません。`, 404);
	}
	const partner = await requireStaffPartner(scope.db, scope.facilityId, row.partner_id);
	return { db: scope.db, partner, row };
}

/** 取引先予約の取消（スタッフ）。台帳・PMS・Stripe 返金・取引先へのメールは cancelPartnerBooking が行う */
export async function cancelPartnerReservation(
	event: RequestEvent,
	reservationCode: string,
	opts: { reason: string; refund: boolean }
): Promise<PartnerBookingRow> {
	const { db, partner, row } = await partnerEditTarget(event, reservationCode);
	return cancelPartnerBooking(db, partner, row.id, 'staff', { reason: opts.reason, origin: event.url.origin, refund: opts.refund });
}

/** チェックイン日決済の再請求（スタッフ） */
export async function retryPartnerReservationCharge(event: RequestEvent, reservationCode: string): Promise<ChargeResult> {
	const { db, partner, row } = await partnerEditTarget(event, reservationCode);
	return retryPartnerCharge(db, partner, row.id, event.url.origin);
}
