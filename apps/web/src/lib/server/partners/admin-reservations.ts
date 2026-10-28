// 予約管理（/admin/reservations）から取引先予約の台帳（public.rms_partner_bookings）を引くための入口。
//
// rms_partner_* は service_role 専用なので、必ず staffPartnerScope（ログイン中スタッフの施設アクセス確認）を
// 通してから触る。施設は管理画面で選んでいる施設（ab_fac）に限る＝台帳の facility_id がそれと一致する予約だけ。
// 取消・再請求は /admin/partners/[id] と同じ関数（cancelPartnerBooking / retryPartnerCharge）を使う。
import { json, type RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readBookingExtras } from './booking-extras';
import { isPartnerBilledBooking } from '$lib/partner-invoice';
import { describeBooker, chargeAmountOf, isAdvanceBankOption, DEPOSIT_BANK_OPTION } from '$lib/partner-booking';
import { advanceInvoiceStateOf, ADVANCE_INVOICE_STATE_LABEL, type AdvanceInvoiceState } from '$lib/partner-advance-invoice';
import {
	advanceInvoiceDownloadResponse,
	getAdvanceInvoice,
	issueAdvanceInvoice,
	listAdvanceInvoicesForBooking,
	voidAdvanceInvoice,
	type AdvanceInvoiceRow
} from './advance-invoices';
import { partnerBookingCodeOf } from '$lib/partner-reservation';
import {
	cancelFeeBasisLabel,
	cancelFeeSettlementLabel,
	cancelKeptNote,
	cancelPartnerBooking,
	depositSummary,
	getPartnerBooking,
	previewPartnerCancel,
	retryPartnerCharge,
	type CancelPreview,
	type ChargeResult,
	type PartnerBookingRow,
	type StaffFeeMode
} from './booking';
import { staffPartnerScope, StaffScopeError } from './staff';
import {
	attachmentView,
	bookingAttachmentPolicy,
	listBookingAttachments,
	partnerBookingAttachmentsEnabled,
	type AttachmentView
} from './booking-attachments';
import { PARTNER_ATTACHMENT_ACCEPT, PARTNER_ATTACHMENT_HINT } from '$lib/partner-attachments';
import { PartnerStoreError, requireStaffPartner, todayJst } from './store';

/** 前受金のご請求書の1枚（予約詳細の表示用） */
export type AdvanceInvoiceView = {
	id: string;
	invoiceNo: string;
	status: 'issued' | 'void';
	issueDate: string;
	dueDate: string;
	amount: number;
	issuedBy: 'auto' | 'staff';
	sentAt: string | null;
	sentTo: string[];
	sendError: string | null;
	voidedAt: string | null;
	voidReason: string | null;
};

/** 銀行振込の事前支払（deposit_bank / advance_bank）の前受金の欄（docs/partner-prepayment.md §4・2026-10-28） */
export type PartnerAdvanceView = {
	amount: number;
	dueDate: string;
	partial: boolean;
	/** 状態（入金待ち／期限超過／入金済み／取消）。入金済みかは台帳の payment_status === 'paid' */
	state: AdvanceInvoiceState;
	stateLabel: string;
	/** 有効な請求書（無ければ null＝自動発行に失敗した等。再発行で出す） */
	current: AdvanceInvoiceView | null;
	/** 取り消した請求書（新しい順） */
	voided: AdvanceInvoiceView[];
	/** 発行・再発行できるか（確定済み・入金前） */
	canIssue: boolean;
};

const advanceInvoiceView = (r: AdvanceInvoiceRow): AdvanceInvoiceView => ({
	id: r.id,
	invoiceNo: r.invoice_no,
	status: r.status,
	issueDate: r.issue_date,
	dueDate: r.due_date,
	amount: r.amount,
	issuedBy: r.issued_by,
	sentAt: r.sent_at,
	sentTo: r.sent_to ?? [],
	sendError: r.send_error,
	voidedAt: r.voided_at,
	voidReason: r.void_reason
});

/** 予約詳細の前受金の欄（銀行振込の事前支払でなければ null）。請求書が読めなくても欄は出す */
async function ledgerAdvance(db: SupabaseClient, b: PartnerBookingRow): Promise<PartnerAdvanceView | null> {
	if (!isAdvanceBankOption(b.payment_option) || !b.advance_amount || !b.advance_due_date || !b.partner_id) return null;
	const rows = await listAdvanceInvoicesForBooking(db, b.partner_id, b.id).catch(() => [] as AdvanceInvoiceRow[]);
	const current = rows.find((r) => r.status === 'issued') ?? null;
	const state = advanceInvoiceStateOf(
		current ?? { status: rows.length ? 'void' : 'issued', due_date: b.advance_due_date },
		b,
		todayJst()
	);
	return {
		amount: b.advance_amount,
		dueDate: b.advance_due_date,
		partial: b.payment_option === DEPOSIT_BANK_OPTION,
		state,
		stateLabel: ADVANCE_INVOICE_STATE_LABEL[state],
		current: current ? advanceInvoiceView(current) : null,
		voided: rows.filter((r) => r.status === 'void').map(advanceInvoiceView),
		canIssue: b.status === 'confirmed' && b.payment_status !== 'paid' && b.payment_status !== 'refunded' && b.payment_status !== 'refund_failed'
	};
}

/** 予約管理の詳細に出す取引先予約の内容（宿泊者のメールは管理者のときだけ入れる） */
export type PartnerLedgerView = {
	id: string;
	partnerId: string | null;
	partnerName: string;
	bookingCode: string;
	status: PartnerBookingRow['status'];
	checkedIn: boolean;
	checkIn: string;
	/** チェックアウト日（カード後日決済の請求日） */
	checkOut: string;
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
	/** 取引先払い（宿泊料金・入湯税は取引先へ月末に請求し、お客様には請求しない）。判定は請求書と同じ isPartnerBilledBooking */
	billedToPartner: boolean;
	/** デポジット予約（Phase 3b）: 「デポジット ○円 お支払い済み・残額 ○円（請求書／現地）」。それ以外は null */
	depositText: string | null;
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
	/** 取消フォームのキャンセル料の見込み（確定済みの予約） */
	cancelPreview: CancelPreview | null;
	/** 取消済みのキャンセル料 */
	cancelFee: { fee: number; waived: boolean; basis: string; settlement: string; kept: string | null; status: string | null; error: string | null; note: string | null } | null;
	refundAmount: number | null;
	invoiceMonth: string;
	hasCard: boolean;
	/** 添付ファイル（2026-10-07・PARTNER_BOOKING_ATTACHMENTS が on のときだけ。off・読めないときは null） */
	attachments: { items: AttachmentView[]; canAdd: boolean; note: string | null; accept: string; hint: string } | null;
	/** 前受金（銀行振込の事前支払のときだけ。それ以外は null） */
	advance: PartnerAdvanceView | null;
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

function toView(b: PartnerBookingRow, isAdmin: boolean, billedToPartner: boolean, cancelPreview: CancelPreview | null): PartnerLedgerView {
	const x = readBookingExtras(b.detail);
	return {
		id: b.id,
		partnerId: b.partner_id,
		partnerName: b.partner_name,
		bookingCode: b.booking_code,
		status: b.status,
		checkedIn: !!b.checkedIn,
		checkIn: b.check_in_date,
		checkOut: b.check_out_date,
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
		billedToPartner,
		depositText: depositSummary(b),
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
		guestEmail: isAdmin ? b.guest_email : null,
		cancelPreview,
		cancelFee:
			b.status === 'cancelled' && b.cancel_fee_settlement
				? {
						fee: b.cancel_fee ?? 0,
						waived: !!b.cancel_fee_waived,
						basis: cancelFeeBasisLabel(b),
						settlement: cancelFeeSettlementLabel(b).replace(/^→ /, ''),
						kept: cancelKeptNote(b),
						status: b.cancel_fee_status ?? null,
						error: b.cancel_fee_error ?? null,
						note: b.cancel_fee_note ?? null
					}
				: null,
		refundAmount: b.refund_amount ?? null,
		invoiceMonth: `${Number(b.check_out_date.slice(0, 4))}年${Number(b.check_out_date.slice(5, 7))}月`,
		hasCard: b.payment_option === 'online_checkin' && !!b.stripe_payment_method_id && (b.payment_status === 'scheduled' || b.payment_status === 'charge_failed'),
		attachments: null,
		advance: null
	};
}

/** 予約詳細の添付ファイル欄（スタッフ: どのファイルも消せる。予約の状態の制限は取引先ページと同じ） */
async function ledgerAttachments(db: SupabaseClient, reservationCode: string, b: PartnerBookingRow): Promise<PartnerLedgerView['attachments']> {
	if (!partnerBookingAttachmentsEnabled() || !b.partner_id) return null;
	try {
		const policy = bookingAttachmentPolicy(b);
		const rows = (await listBookingAttachments(db, b.partner_id, [b.id])).get(b.id) ?? [];
		const base = `/admin/reservations/${encodeURIComponent(reservationCode)}/attachments`;
		return {
			items: rows.map((r) => attachmentView(r, { href: `${base}/${r.id}`, canDelete: policy.canDelete, audience: 'staff' })),
			canAdd: policy.canAdd,
			note: policy.note,
			accept: PARTNER_ATTACHMENT_ACCEPT,
			hint: PARTNER_ATTACHMENT_HINT
		};
	} catch {
		return null;
	}
}

/**
 * 添付ファイルの操作（追加・削除・ダウンロード・PMS への通知）の共通: 施設・台帳・取引先の所属を確かめる。
 * 閲覧の権限（施設アクセスのあるスタッフ）で通す: 名簿・行程表などの現場の資料で、金額・資格情報を扱わないため
 * （取消・再請求の partnerEditTarget＝管理者のみ、より広い）。
 */
export async function partnerAttachmentTarget(event: RequestEvent, reservationCode: string) {
	if (!partnerBookingAttachmentsEnabled()) throw new PartnerStoreError('ページが見つかりません。', 404);
	const code = partnerBookingCodeOf(reservationCode);
	if (!code) throw new PartnerStoreError('取引先予約ではありません。', 400);
	const scope = await staffPartnerScope(event, 'view');
	const row = await findLedgerRow(scope.db, scope.facilityId, code);
	if (!row?.partner_id) {
		throw new PartnerStoreError(`いま選んでいる施設（${scope.facilityName}）の取引先予約に ${code} が見つかりません。`, 404);
	}
	const partner = await requireStaffPartner(scope.db, scope.facilityId, row.partner_id);
	return {
		db: scope.db,
		partner,
		row,
		policy: bookingAttachmentPolicy(row),
		staff: { userId: scope.userId, label: event.locals.user?.name || 'スタッフ' }
	};
}

/** 添付ファイルの API（管理画面）の失敗応答（権限・台帳の理由はそのまま JSON で返す） */
export function partnerAttachmentApiError(e: unknown): Response {
	if (e instanceof StaffScopeError || e instanceof PartnerStoreError) {
		return json({ ok: false, message: e.message }, { status: e.status >= 400 && e.status < 600 ? e.status : 400, headers: { 'cache-control': 'private, no-store' } });
	}
	throw e;
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
		// 取引先払いかの判定に取引先の設定（自由入力の支払方法の billable）が要る。読めなくても台帳は出す
		const partner = row.partner_id ? await requireStaffPartner(scope.db, scope.facilityId, row.partner_id).catch(() => null) : null;
		// デポジット（Phase 3b）は残額の精算先（予約時のスナップショット）で判定する
		const billed = isPartnerBilledBooking(row, partner?.booking_settings ?? { customPaymentOptions: [] });
		const preview = row.checkedIn ? null : await previewPartnerCancel(scope.db, scope.facilityId, row).catch(() => null);
		const view = toView(row, event.locals.user?.role === 'admin', billed, preview);
		view.attachments = await ledgerAttachments(scope.db, reservationCode, row);
		view.advance = await ledgerAdvance(scope.db, row);
		return { ledger: view, error: null };
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
	return { db: scope.db, partner, row, userId: scope.userId };
}

/** 取引先予約の取消（スタッフ）。台帳・PMS・Stripe 返金・取引先へのメールは cancelPartnerBooking が行う */
export async function cancelPartnerReservation(
	event: RequestEvent,
	reservationCode: string,
	opts: { reason: string; refund: boolean; feeMode?: StaffFeeMode; customFee?: number | null; feeNote?: string; adminFeeWaived?: boolean }
): Promise<PartnerBookingRow> {
	const { db, partner, row } = await partnerEditTarget(event, reservationCode);
	return cancelPartnerBooking(db, partner, row.id, 'staff', { ...opts, origin: event.url.origin });
}

/** チェックアウト日決済の再請求（スタッフ） */
export async function retryPartnerReservationCharge(event: RequestEvent, reservationCode: string): Promise<ChargeResult> {
	const { db, partner, row } = await partnerEditTarget(event, reservationCode);
	return retryPartnerCharge(db, partner, row.id, event.url.origin);
}

// ---------------------------------------------------------------------------
// 前受金のご請求書（銀行振込の事前支払・docs/partner-prepayment.md §5・2026-10-28）
// ---------------------------------------------------------------------------

/**
 * 前受金のご請求書の再発行（管理者のみ・取消と同じ partnerEditTarget の確認）。
 * 有効な1枚があれば「再発行」の理由で取り消してから新しく発行し、予約者へメールする。無ければ（自動発行の失敗など）そのまま発行する。
 */
export async function reissuePartnerAdvanceInvoice(event: RequestEvent, reservationCode: string): Promise<{ invoiceNo: string; sent: boolean; reason: string | null }> {
	const { db, partner, row, userId } = await partnerEditTarget(event, reservationCode);
	const current = (await listAdvanceInvoicesForBooking(db, partner.id, row.id)).find((r) => r.status === 'issued');
	if (current) await voidAdvanceInvoice(db, current.id, { reason: '再発行', staffId: userId, partnerId: partner.id });
	const r = await issueAdvanceInvoice(db, partner, row, { by: 'staff', staffId: userId, send: true, origin: event.url.origin });
	return { invoiceNo: r.invoice.invoice_no, sent: !!r.mail?.sent, reason: r.mail?.reason ?? null };
}

/** 前受金のご請求書の取消（管理者のみ・理由必須）。台帳の advance_invoice_id はそのまま（履歴） */
export async function voidPartnerAdvanceInvoice(event: RequestEvent, reservationCode: string, invoiceId: string, reason: string): Promise<string> {
	const { db, partner, row, userId } = await partnerEditTarget(event, reservationCode);
	const inv = await getAdvanceInvoice(db, partner.id, invoiceId);
	// この予約の請求書だけ（別の予約の請求書 ID を渡されても取り消さない）
	if (!inv || inv.booking_id !== row.id) throw new PartnerStoreError('前受金のご請求書が見つかりません。', 404);
	const voided = await voidAdvanceInvoice(db, inv.id, { reason, staffId: userId, partnerId: partner.id });
	return voided.invoice_no;
}

/**
 * 前受金のご請求書のダウンロード（閲覧の権限＝施設アクセスのあるスタッフ。月次の請求書のダウンロードと同じ）。
 * 施設・台帳・取引先の所属を確かめ、その予約の請求書だけを返す（取消済みも管理画面では開ける）。
 */
export async function partnerAdvanceInvoiceDownload(event: RequestEvent, reservationCode: string, invoiceId: string, format: 'pdf' | 'html'): Promise<Response> {
	const code = partnerBookingCodeOf(reservationCode);
	if (!code) throw new PartnerStoreError('取引先予約ではありません。', 400);
	const scope = await staffPartnerScope(event, 'view');
	const row = await findLedgerRow(scope.db, scope.facilityId, code);
	if (!row?.partner_id) {
		throw new PartnerStoreError(`いま選んでいる施設（${scope.facilityName}）の取引先予約に ${code} が見つかりません。`, 404);
	}
	const inv = await getAdvanceInvoice(scope.db, row.partner_id, invoiceId);
	if (!inv || inv.booking_id !== row.id) throw new PartnerStoreError('前受金のご請求書が見つかりません。', 404);
	return advanceInvoiceDownloadResponse(inv, format, { 'cache-control': 'private, no-store' });
}
