// 管理画面: 取引先の詳細（限定URL・覚書・公開設定・特別レート・予約受付・プレビュー・予約・請求書・ログインID・API キー・アクセスログ）。
// autumn-rms の /partners/[id]（v0.103.0）から移設（2026-09-26）。
// 閲覧は admin / staff、操作（保存・再発行・発行・取消と返金・再請求・削除・請求書の発行・再送・取消）は admin のみ（staff.ts の canEditPartners）。
// PMS の顧客マスタとの紐づけ（2026-10-07・Phase 1）: 候補の検索は閲覧権限で、紐づけ・解除は admin のみ。
// 予約名義（2026-10-07・Phase 2）: 紐づけ済みのときだけ選べる。変更は admin のみ（setBookingNameMode）。
import { redirect, type RequestEvent } from '@sveltejs/kit';
import { ADVANCE_PLAN_CODE, DEFAULT_PARTNER_PRICING, type PartnerPricing } from '$lib/partner-pricing';
import { describeBooker, normalizeBooker, normalizePartnerBookingSettings } from '$lib/partner-booking';
import { friendlyId } from '$lib/server/partners/crypto';
import { loadPartnerRates } from '$lib/server/partners/rates';
import { describePublishableKeyIssue } from '$lib/server/payments/keys';
import { publishableKeyProblem } from '$lib/server/stripe';
import {
	cancelPartnerBooking,
	isPartnerBookingOpen,
	isStripeTestMode,
	bookingNameLineOf,
	listPartnerBookings,
	parseStaffFeeForm,
	previewPartnerCancels,
	cancelFeeBasisLabel,
	cancelFeeSettlementLabel,
	inlinePaymentReady,
	onlinePaymentReady,
	retryPartnerCharge,
	stripeKeyHint,
	stripeKeyKind
} from '$lib/server/partners/booking';
import {
	addDaysIso,
	createPartnerAccount,
	deletePartner,
	deletePartnerAccount,
	getPmsPartnerGuest,
	issuePartnerApiKey,
	listPartnerAccessLogs,
	listPartnerAccounts,
	listPartnerApiKeys,
	PARTNER_KIND_LABELS,
	PartnerStoreError,
	regeneratePartnerUrl,
	reissueSetupToken,
	requireStaffPartner,
	revokePartnerApiKey,
	searchPmsPartnerGuests,
	setPartnerBookingNameMode,
	setPartnerPmsGuest,
	todayJst,
	updatePartner,
	updatePartnerAccount
} from '$lib/server/partners/store';
import {
	actionFailure,
	partnerPortalUrl,
	sendSetupEmail,
	staffPartnerScope,
	StaffScopeError
} from '$lib/server/partners/staff';
import { isEmail, parsePartnerSettings } from '$lib/server/partners/staff-form';
import {
	deletePartnerDocument,
	formatBytes,
	getPartnerMemorandum,
	listPartnerDocuments,
	MAX_MEMORANDUM_LENGTH,
	PARTNER_DOCUMENT_ACCEPT,
	savePartnerMemorandum,
	uploadPartnerDocument
} from '$lib/server/partners/memorandum';
import {
	issuePartnerInvoice,
	listPartnerInvoices,
	normalizePeriod,
	previewPartnerInvoice,
	getPartnerInvoice,
	sendPartnerInvoiceMail,
	voidPartnerInvoice
} from '$lib/server/partners/invoices';
import { invoicePdfReady } from '$lib/server/partners/invoice-pdf';
import { isBillablePaymentOption, periodOf } from '$lib/partner-invoice';
import { photoFileProblem } from '$lib/content-blocks';
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbUploadContentPhoto } from '$lib/server/content-admin';
import { BOOKING_NAME_MODES, pmsGuestUrl, type BookingNameMode } from '$lib/pms-partner-guest';
import type { Actions, PageServerLoad } from './$types';

// プレビュー用: 全プランを基準価格（理論値）のまま取る。特別レートは画面側で編集中のルールを当てて計算する
// （保存しなくても結果が見えるように）。
const PREVIEW_BASE_PRICING: PartnerPricing = {
	...DEFAULT_PARTNER_PRICING,
	defaultAction: 'adjust',
	defaultAdjustType: 'percent',
	defaultValue: 0,
	rules: [],
	roundingUnit: 1,
	minPricePerPerson: null,
	maxPricePerPerson: null
};

const PREVIEW_DAYS = 14;

export const load: PageServerLoad = async (event) => {
	let scope;
	try {
		scope = await staffPartnerScope(event, 'view');
	} catch (e) {
		// 使えない環境・権限なしは一覧で理由を出す
		if (e instanceof StaffScopeError) redirect(303, '/admin/partners');
		throw e;
	}
	let partner;
	try {
		partner = await requireStaffPartner(scope.db, scope.facilityId, event.params.id);
	} catch (e) {
		// 別施設の取引先（施設を切り替えた直後など）・存在しない ID は一覧へ
		if (e instanceof PartnerStoreError) redirect(303, '/admin/partners');
		throw e;
	}

	const today = todayJst();
	const previewParam = event.url.searchParams.get('preview') ?? '';
	const previewFrom = /^\d{4}-\d{2}-\d{2}$/.test(previewParam) && previewParam >= today ? previewParam : today;
	const previewTo = addDaysIso(previewFrom, PREVIEW_DAYS - 1);

	// 請求書: 対象月（?inv=YYYY-MM・既定は当月）のプレビューと発行済み一覧
	const currentPeriod = periodOf(today);
	const invPeriodRaw = normalizePeriod(event.url.searchParams.get('inv'));
	const invoicePeriod = invPeriodRaw && invPeriodRaw <= currentPeriod ? invPeriodRaw : currentPeriod;

	const [accounts, apiKeys, logs, bookings, preview, memo, documents, invoices, invoicePreview, pmsGuest] = await Promise.all([
		listPartnerAccounts(scope.db, partner.id),
		listPartnerApiKeys(scope.db, partner.id),
		listPartnerAccessLogs(scope.db, partner.id, 50),
		listPartnerBookings(scope.db, { partnerId: partner.id, limit: 200 }),
		// プレビューは公開停止中でも見られるように、取引先の公開状態は見ずに計算する。
		loadPartnerRates(
			scope.db,
			{ ...partner, pricing: PREVIEW_BASE_PRICING, include_advance: true, show_inventory: true },
			{ from: previewFrom, to: previewTo }
		)
			.then((r) => ({ ...r, error: null as string | null }))
			.catch((e) => ({
				days: [],
				rooms: [] as { roomCode: string; name: string }[],
				planOptions: [] as { code: string; label: string; mealType: string | null }[],
				error: e instanceof Error ? e.message : String(e)
			})),
		// 覚書（本文・ファイル）。読めなくても他の欄は出す
		getPartnerMemorandum(scope.db, partner.id)
			.then((m) => ({ ...m, error: null as string | null }))
			.catch((e) => ({ text: '', updatedAt: null as string | null, error: e instanceof Error ? e.message : String(e) })),
		listPartnerDocuments(scope.db, partner.id)
			.then((rows) => ({ rows, error: null as string | null }))
			.catch((e) => ({ rows: [], error: e instanceof Error ? e.message : String(e) })),
		// 請求書（読めなくても他の欄は出す）
		listPartnerInvoices(scope.db, partner.id)
			.then((rows) => ({ rows, error: null as string | null }))
			.catch((e) => ({ rows: [], error: e instanceof Error ? e.message : String(e) })),
		previewPartnerInvoice(scope.db, partner, invoicePeriod)
			.then((r) => ({ ...r, error: null as string | null }))
			.catch((e) => ({ document: null, bookingCount: 0, settings: null, chargeFailed: [] as string[], error: e instanceof Error ? e.message : String(e) })),
		// PMS の顧客マスタの紐づけ先（読めなくても他の欄は出す）
		getPmsPartnerGuest(scope.db, partner.tenant_id, partner.pms_guest_id)
			.then((guest) => ({ guest, error: null as string | null }))
			.catch((e) => ({ guest: null, error: e instanceof Error ? e.message : String(e) }))
	]);

	// ルール編集の選択肢。プランは直近の料金（rms_partner_portal_source）に出ているプラングループから集める
	// （同じコードが部屋タイプ間で共通なので、コード単位でまとめる）。保存済みルールにしか無いコードも残す。
	const planMap = new Map(preview.planOptions.map((p) => [p.code, p]));
	const roomMap = new Map(preview.rooms.map((r) => [r.roomCode, { code: r.roomCode, name: r.name }]));
	for (const rule of partner.pricing.rules) {
		for (const code of rule.planGroupCodes) {
			if (code !== ADVANCE_PLAN_CODE && !planMap.has(code)) planMap.set(code, { code, label: code, mealType: null });
		}
		for (const code of rule.roomCodes) if (!roomMap.has(code)) roomMap.set(code, { code, name: code });
	}
	const planOptions = [...planMap.values()].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));

	const accountLabel = new Map(accounts.map((a) => [a.id, a.login_id]));
	const keyLabel = new Map(apiKeys.map((k) => [k.id, k.label || k.key_prefix]));
	const origin = event.url.origin;

	// 取消フォームに出すキャンセル料の見込み（確定済み・未チェックインの予約）
	const cancelPreviews = await previewPartnerCancels(scope.db, partner.facility_id, bookings).catch(() => ({}) as Awaited<ReturnType<typeof previewPartnerCancels>>);
	return {
		facilityName: scope.facilityName,
		facilitySlugHint: scope.bookFacilityId === 'f-oga' ? 'oga' : 'yamado',
		canEdit: scope.canEdit,
		kindLabels: PARTNER_KIND_LABELS,
		today,
		partner: {
			id: partner.id,
			name: partner.name,
			kind: partner.kind,
			contactName: partner.contact_name,
			contactEmail: partner.contact_email,
			isActive: partner.is_active,
			validFrom: partner.valid_from,
			validUntil: partner.valid_until,
			maxDaysAhead: partner.max_days_ahead,
			showInventory: partner.show_inventory,
			includeAdvance: partner.include_advance,
			pricing: partner.pricing,
			note: partner.note,
			bookingEnabled: partner.booking_enabled,
			bookingSettings: partner.booking_settings,
			bookingOpen: isPartnerBookingOpen(partner),
			updatedAt: partner.updated_at
		},
		portalUrl: partnerPortalUrl(origin, partner.url_token),
		// PMS の顧客マスタ（旅行会社・法人）との紐づけ。guestId があるのに guest が null = 紐づけ先が見つからない（統合・種別変更など）
		pmsLink: {
			guestId: partner.pms_guest_id,
			guest: pmsGuest.guest ? { ...pmsGuest.guest, url: pmsGuestUrl(pmsGuest.guest.id) } : null,
			error: pmsGuest.error,
			// 予約名義（Phase 2）。紐づけが無ければ DB のトリガーで常に guest
			bookingNameMode: partner.booking_name_mode
		},
		memorandum: { text: memo.text, updatedAt: memo.updatedAt, maxLength: MAX_MEMORANDUM_LENGTH, error: memo.error },
		documents: documents.rows.map((d) => ({
			id: d.id,
			fileName: d.file_name,
			size: formatBytes(d.byte_size),
			// 保存者: 宿（スタッフ名）／取引先（ログインID）
			byKind: d.uploaded_by_kind,
			byLabel:
				d.uploaded_by_kind === 'partner'
					? (d.uploaded_by_label ?? (d.uploaded_by_account ? (accountLabel.get(d.uploaded_by_account) ?? '(削除済み)') : ''))
					: (d.uploaded_by_label ?? ''),
			note: d.note,
			createdAt: d.created_at
		})),
		documentsError: documents.error,
		documentAccept: PARTNER_DOCUMENT_ACCEPT,
		apiEndpoint: `${origin}/api/partner/v1/rates`,
		accounts: accounts.map((a) => ({
			id: a.id,
			// Book のスタッフが発行したものはマスタ。子ユーザーは作成者（マスタのログインID）を出す
			// is_master / created_by_account は listPartnerAccounts（store.ts の ACCOUNT_COLUMNS）で読み済み
			isMaster: a.is_master !== false,
			createdBy: a.created_by_account ? (accountLabel.get(a.created_by_account) ?? '(削除済み)') : null,
			loginId: a.login_id,
			displayName: a.display_name,
			email: a.email,
			hasPassword: Boolean(a.password_hash),
			passwordSetAt: a.password_set_at,
			setupPending: Boolean(a.setup_token_expires_at),
			setupExpiresAt: a.setup_token_expires_at,
			lockedUntil: a.locked_until && new Date(a.locked_until).getTime() > Date.now() ? a.locked_until : null,
			lastLoginAt: a.last_login_at,
			isActive: a.is_active
		})),
		apiKeys: apiKeys.map((k) => ({
			id: k.id,
			label: k.label,
			prefix: k.key_prefix,
			lastUsedAt: k.last_used_at,
			revokedAt: k.revoked_at,
			createdAt: k.created_at
		})),
		logs: logs.map((l) => ({
			id: l.id,
			at: l.created_at,
			channel: l.channel,
			action: l.action,
			who: l.account_id ? (accountLabel.get(l.account_id) ?? '(削除済み)') : l.api_key_id ? (keyLabel.get(l.api_key_id) ?? '(削除済み)') : null,
			detail: l.detail,
			ip: l.ip
		})),
		rooms: [...roomMap.values()],
		planOptions,
		// 取引先の画面に同じ画面で払う決済を出せるか（シークレットキー＋公開可能キー）。出せない理由は下の2つ
		onlinePaymentReady: inlinePaymentReady(),
		stripeSecretReady: onlinePaymentReady(),
		stripePublishableIssue: onlinePaymentReady() && publishableKeyProblem() ? describePublishableKeyIssue(publishableKeyProblem()!) : null,
		stripeTestMode: isStripeTestMode(),
		stripeKeyKind: stripeKeyKind(),
		stripeKeyHint: stripeKeyKind() === 'invalid' ? stripeKeyHint() : null,
		bookings: bookings.map((b) => ({
			// キャンセル料の見込み（取消フォーム）と、取消済みのキャンセル料
			cancelPreview: cancelPreviews[b.id] ?? null,
			cancelFee:
				b.status === 'cancelled' && b.cancel_fee_settlement
					? { fee: b.cancel_fee ?? 0, waived: !!b.cancel_fee_waived, basis: cancelFeeBasisLabel(b), settlement: cancelFeeSettlementLabel(b).replace(/^→ /, ''), status: b.cancel_fee_status ?? null, error: b.cancel_fee_error ?? null, note: b.cancel_fee_note ?? null }
					: null,
			invoiceMonth: `${Number(b.check_out_date.slice(0, 4))}年${Number(b.check_out_date.slice(5, 7))}月`,
			hasCard: b.payment_option === 'online_checkin' && !!b.stripe_payment_method_id && (b.payment_status === 'scheduled' || b.payment_status === 'charge_failed'),
			id: b.id,
			code: b.booking_code,
			status: b.status,
			checkedIn: !!b.checkedIn,
			checkIn: b.check_in_date,
			checkOut: b.check_out_date,
			nights: b.nights,
			roomName: b.room_name ?? b.room_code ?? '',
			roomCount: b.room_count,
			adultTotal: b.adult_total,
			planName: b.plan_name ?? '',
			guestName: b.guest_name,
			// 旅行会社名義の予約（Phase 2）: 一覧の印と名義の行（予約時の紐づけ先の名称）
			nameMode: b.name_mode ?? 'guest',
			nameLine: bookingNameLineOf(b),
			phone: b.guest_phone,
			// 合計は入湯税を含む（宿泊料金＋入湯税）。キャンセル料の基準は宿泊料金（lodging）だけ
			total: b.total_amount + (b.bath_tax_amount ?? 0),
			lodging: b.total_amount,
			bathTax: b.bath_tax_amount ?? 0,
			cardConsentAt: b.card_consent_at,
			cardConsentText: b.card_consent_text,
			bookedBy: b.booked_by,
			createdAt: b.created_at,
			cancelledAt: b.cancelled_at,
			cancelledBy: b.cancelled_by,
			paymentName: b.payment_method_name,
			paymentStatus: b.payment_status,
			paymentOption: b.payment_option,
			// 取引先払い（宿泊料金・入湯税は取引先へ月末に請求し、お客様には請求しない）
			billedToPartner: isBillablePaymentOption(b.payment_option, partner.booking_settings),
			cardLabel: b.card_label,
			chargeError: b.charge_error,
			refundError: b.refund_error,
			...bookingExtras(b.detail)
		})),
		preview: { from: previewFrom, to: previewTo, days: preview.days, error: preview.error },
		invoices: {
			period: invoicePeriod,
			currentPeriod,
			pdfReady: invoicePdfReady(),
			error: invoices.error,
			rows: invoices.rows.map((r) => ({
				id: r.id,
				invoiceNo: r.invoice_no,
				period: r.period,
				issueDate: r.issue_date,
				dueDate: r.due_date,
				status: r.status,
				usageTotal: r.usage_total,
				billedTotal: r.billed_total,
				bookingCount: r.booking_ids.length,
				issuedBy: r.issued_by,
				sentAt: r.sent_at,
				sentTo: r.sent_to,
				sendError: r.send_error,
				voidedAt: r.voided_at,
				voidReason: r.void_reason,
				createdAt: r.created_at
			})),
			preview: invoicePreview.document
				? {
						lines: invoicePreview.document.lines,
						totals: invoicePreview.document.totals,
						dueDate: invoicePreview.document.dueDate,
						recipient: invoicePreview.document.recipient,
						issuer: invoicePreview.document.issuer
					}
				: null,
			previewError: invoicePreview.error,
			// カード決済が失敗したままの予約（請求書には「カード決済失敗（要確認）」で載り、請求はしない）
			chargeFailed: invoicePreview.chargeFailed,
			bankAccountMissing: invoicePreview.settings ? !invoicePreview.settings.bankAccount : false,
			autoIssue: invoicePreview.settings?.autoIssue ?? true
		}
	};
};

// 予約の detail のうち、取引先ページの予約フォーム（2026-10-01）で増えた項目。古い予約には無いので、あるときだけ返す。
//   booker    … 予約者（取引先の予約担当者）
//   transport … 交通手段（「JR」「車」「その他（○○）」）
//   perks     … 付いた取引先特典（{title, description} の並び。文字列でも受ける）
function bookingExtras(detail: unknown): { booker: string | null; transport: string | null; perks: string[] } {
	const d = (detail && typeof detail === 'object' ? detail : {}) as Record<string, unknown>;
	const booker = d.booker && typeof d.booker === 'object' ? normalizeBooker(d.booker) : null;
	const perksRaw = Array.isArray(d.perks) ? d.perks : typeof d.perks === 'string' && d.perks ? [d.perks] : [];
	const perks = perksRaw
		.map((p) => (typeof p === 'string' ? p : p && typeof p === 'object' ? String((p as Record<string, unknown>).title ?? '') : '').trim())
		.filter(Boolean);
	return {
		booker: booker?.name ? describeBooker(booker) : null,
		transport: typeof d.transport === 'string' && d.transport.trim() ? d.transport.trim() : null,
		perks
	};
}

// 各アクション共通: 編集権限（admin）・施設・取引先の所属を確かめる。
async function editScope(event: RequestEvent) {
	const scope = await staffPartnerScope(event, 'edit');
	const partner = await requireStaffPartner(scope.db, scope.facilityId, event.params.id ?? '');
	return { ...scope, partner };
}

async function issueSetupLink(
	event: RequestEvent,
	s: Awaited<ReturnType<typeof editScope>>,
	account: { login_id: string; email: string | null },
	setupToken: string,
	sendTo: string | null
) {
	const origin = event.url.origin;
	const loginUrl = partnerPortalUrl(origin, s.partner.url_token);
	const setupUrl = partnerPortalUrl(origin, s.partner.url_token, `/setup?token=${encodeURIComponent(setupToken)}`);
	let emailResult: { sent: boolean; reason?: string } | null = null;
	if (sendTo) {
		emailResult = await sendSetupEmail(s.db, {
			to: sendTo,
			partner: s.partner,
			facilityName: s.facilityName,
			loginId: account.login_id,
			setupUrl,
			loginUrl
		});
	}
	return { loginId: account.login_id, setupUrl, emailSent: emailResult?.sent ?? null, emailReason: emailResult?.reason ?? null };
}

export const actions: Actions = {
	// PMS の顧客マスタ（旅行会社・法人）の候補を探す。閲覧権限でよい（返すのは社名・かな・支店・顧客コードだけ）
	searchPmsGuests: async (event) => {
		try {
			const scope = await staffPartnerScope(event, 'view');
			const partner = await requireStaffPartner(scope.db, scope.facilityId, event.params.id ?? '');
			const query = String((await event.request.formData()).get('q') ?? '').trim();
			if (!query) return { pmsGuestQuery: query, pmsGuestResults: [] };
			const results = await searchPmsPartnerGuests(scope.db, partner.tenant_id, query);
			return { pmsGuestQuery: query, pmsGuestResults: results.map((g) => ({ ...g, url: pmsGuestUrl(g.id) })) };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// PMS の顧客に紐づける（guest_id）。顧客が同じテナントの旅行会社・法人であることは setPartnerPmsGuest で確かめる
	linkPmsGuest: async (event) => {
		try {
			const { db, facilityId, partner, userId } = await editScope(event);
			const guestId = String((await event.request.formData()).get('guest_id') ?? '').trim();
			if (!guestId) return actionFailure(new PartnerStoreError('紐づける顧客を選んでください。'));
			await setPartnerPmsGuest(db, facilityId, partner.id, guestId, userId);
			return { pmsLinked: true };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 紐づけを外す（取引先の他の設定は変えない。名義は DB のトリガーが「宿泊者名」に戻す）
	unlinkPmsGuest: async (event) => {
		try {
			const { db, facilityId, partner, userId } = await editScope(event);
			await setPartnerPmsGuest(db, facilityId, partner.id, null, userId);
			return { pmsUnlinked: true };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 予約名義（Phase 2）。紐づけ・解除と同じく「押した時点で保存」にする: 名義は紐づけと一体の設定で、
	// 同じ欄の中で紐づけは即時保存・名義だけ「保存する」待ち、だと押し忘れ・食い違いが起きるため。
	// 紐づけが無い（または紐づけ先が読めない）のに partner は setPartnerBookingNameMode が拒否する。
	setBookingNameMode: async (event) => {
		try {
			const { db, facilityId, partner, userId } = await editScope(event);
			const raw = String((await event.request.formData()).get('mode') ?? '');
			if (!(BOOKING_NAME_MODES as readonly string[]).includes(raw)) return actionFailure(new PartnerStoreError('予約名義の指定が正しくありません。'));
			const saved = await setPartnerBookingNameMode(db, facilityId, partner.id, raw as BookingNameMode, userId);
			return { bookingNameMode: saved.booking_name_mode };
		} catch (e) {
			return actionFailure(e);
		}
	},

	save: async (event) => {
		try {
			const { db, partner, userId } = await editScope(event);
			const input = parsePartnerSettings(await event.request.formData());
			await updatePartner(db, partner, userId, input);
			return { saved: true };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 覚書の本文（取引条件のまとめ）。取引先ページの「覚書」にそのまま出る
	saveMemorandum: async (event) => {
		try {
			const { db, partner, userId } = await editScope(event);
			const fd = await event.request.formData();
			await savePartnerMemorandum(db, partner, String(fd.get('memorandum') ?? ''), userId);
			return { memorandumSaved: true };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 取引先特典の画像（2026-10-03）。book-photos に上げ、保存済みの特典ならその場で imageUrl も保存する
	// （「保存する」の押し忘れで画像が出ない、を防ぐ。まだ保存していない新しい特典は「保存する」で確定）。
	// remove=1 なら画像を外す（ファイルは消さない）。
	uploadPerkImage: async (event) => {
		try {
			const { db, partner, userId, facilityId } = await editScope(event);
			const fd = await event.request.formData();
			const perkId = String(fd.get('perk_id') ?? '');
			let url = '';
			if (fd.get('remove') !== '1') {
				const file = fd.get('photo');
				const problem = photoFileProblem(file instanceof File ? file : null);
				if (problem) return actionFailure(new PartnerStoreError(problem));
				url = await sbUploadContentPhoto(createSupabaseServerClient(event), 'partners', facilityId, file as File);
			}
			const current = partner.booking_settings;
			const persisted = current.perks.some((p) => p.id === perkId);
			if (persisted) {
				const perks = current.perks.map((p) => (p.id === perkId ? { ...p, imageUrl: url } : p));
				await updatePartner(db, partner, userId, { booking_settings: normalizePartnerBookingSettings({ ...current, perks }) });
			}
			return { perkImageUploaded: url, perkImagePersisted: persisted };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 覚書のファイル（宿側から保存）。取引先ページの「覚書」にも出る
	uploadDocument: async (event) => {
		try {
			const { db, partner, userId } = await editScope(event);
			const fd = await event.request.formData();
			const file = fd.get('file');
			if (!(file instanceof File) || file.size === 0) return actionFailure(new PartnerStoreError('ファイルを選んでください。'));
			const doc = await uploadPartnerDocument(
				db,
				partner,
				file,
				{ kind: 'staff', userId, label: event.locals.user?.name || 'スタッフ' },
				String(fd.get('note') ?? '')
			);
			return { documentUploaded: doc.file_name };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 覚書のファイルの削除（スタッフはどのファイルも削除できる。取引先が保存したものも含む）
	deleteDocument: async (event) => {
		try {
			const { db, partner } = await editScope(event);
			const fd = await event.request.formData();
			await deletePartnerDocument(db, partner.id, String(fd.get('document_id') ?? ''));
			return { documentDeleted: true };
		} catch (e) {
			return actionFailure(e);
		}
	},

	regenerateUrl: async (event) => {
		try {
			const { db, partner, userId } = await editScope(event);
			await regeneratePartnerUrl(db, partner, userId);
			return { urlRegenerated: true };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 取引先予約の取消（スタッフ）。取引先側の取消期限は問わない（チェックイン済みは不可）。
	cancelBooking: async (event) => {
		try {
			const { db, partner } = await editScope(event);
			const fd = await event.request.formData();
			const b = await cancelPartnerBooking(db, partner, String(fd.get('booking_id') ?? ''), 'staff', {
				reason: String(fd.get('reason') ?? ''),
				origin: event.url.origin,
				// オンライン決済済みの予約を返金するか（画面のチェック。既定は返金する）
				refund: fd.get('refund') !== null,
				...parseStaffFeeForm(fd)
			});
			return { bookingCancelled: b.booking_code };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// チェックイン日決済の再請求（請求失敗・チェックイン日を迎えた請求予定）
	retryCharge: async (event) => {
		try {
			const { db, partner } = await editScope(event);
			const fd = await event.request.formData();
			const r = await retryPartnerCharge(db, partner, String(fd.get('booking_id') ?? ''), event.url.origin);
			return { chargeResult: r };
		} catch (e) {
			return actionFailure(e);
		}
	},

	deletePartner: async (event) => {
		try {
			const { db, partner } = await editScope(event);
			await deletePartner(db, partner);
		} catch (e) {
			return actionFailure(e);
		}
		redirect(303, '/admin/partners');
	},

	createAccount: async (event) => {
		try {
			const s = await editScope(event);
			const fd = await event.request.formData();
			const prefix = s.bookFacilityId === 'f-oga' ? 'oga' : 'yamado';
			const loginId = String(fd.get('login_id') ?? '').trim() || `${prefix}-${friendlyId(6)}`;
			const email = String(fd.get('email') ?? '').trim() || null;
			if (email && !isEmail(email)) throw new PartnerStoreError('メールアドレスの形式が正しくありません。');
			const displayName = String(fd.get('display_name') ?? '').trim().slice(0, 80) || null;
			const { account, setupToken } = await createPartnerAccount(s.db, s.partner, { loginId, displayName, email, userId: s.userId });
			const issued = await issueSetupLink(event, s, account, setupToken, email && fd.get('send_email') === 'on' ? email : null);
			return { issued };
		} catch (e) {
			return actionFailure(e);
		}
	},

	reissueSetup: async (event) => {
		try {
			const s = await editScope(event);
			const fd = await event.request.formData();
			const { account, setupToken } = await reissueSetupToken(s.db, s.partner, String(fd.get('account_id') ?? ''));
			const issued = await issueSetupLink(
				event,
				s,
				account,
				setupToken,
				account.email && fd.get('send_email') === 'on' ? account.email : null
			);
			return { issued };
		} catch (e) {
			return actionFailure(e);
		}
	},

	updateAccount: async (event) => {
		try {
			const { db, partner } = await editScope(event);
			const fd = await event.request.formData();
			const op = String(fd.get('op') ?? '');
			const accountId = String(fd.get('account_id') ?? '');
			if (op === 'delete') {
				await deletePartnerAccount(db, partner, accountId);
			} else {
				const patch = op === 'disable' ? { is_active: false } : op === 'enable' ? { is_active: true } : op === 'unlock' ? { unlock: true } : null;
				if (!patch) throw new PartnerStoreError('不明な操作です。');
				await updatePartnerAccount(db, partner, accountId, patch);
			}
			return { accountUpdated: true };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 請求書を今すぐ発行（対象月を選ぶ）。発行済みの月は既存を返す（二重発行しない）
	issueInvoice: async (event) => {
		try {
			const { db, partner, userId } = await editScope(event);
			const fd = await event.request.formData();
			const period = normalizePeriod(String(fd.get('period') ?? ''));
			if (!period) throw new PartnerStoreError('対象月を選んでください。');
			const res = await issuePartnerInvoice(db, partner, period, {
				by: 'staff',
				staffId: userId,
				send: fd.get('send') !== null,
				origin: event.url.origin
			});
			if (!res) return { invoiceResult: { kind: 'empty' as const, message: 'この月（今日まで）にチェックアウトの確定予約がないため、発行しませんでした。' } };
			const inv = res.invoice;
			if (!res.created) {
				return { invoiceResult: { kind: 'existing' as const, message: `この月は発行済みです（${inv.invoice_no}）。作り直すときは取り消してから発行してください。` } };
			}
			const mailNote = res.mail ? (res.mail.sent ? `・${res.mail.to.join(', ')} へ送信しました${res.mail.attachedPdf ? '（PDF 添付）' : '（PDF なし・ページへ案内）'}` : `・送信できませんでした（${res.mail.reason}）`) : '';
			// カード決済が失敗したままの予約は請求せず「カード決済失敗（要確認）」で載せる。見落とさないよう知らせる
			const failedNote = res.chargeFailed.length
				? `（注意: カード決済が失敗したままの予約 ${res.chargeFailed.join('、')} は請求していません。予約の画面で再請求するか、別途ご精算ください）`
				: '';
			return { invoiceResult: { kind: 'issued' as const, message: `${inv.invoice_no} を発行しました${mailNote}。${failedNote}` } };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 請求書のメール再送
	resendInvoice: async (event) => {
		try {
			const { db, partner } = await editScope(event);
			const fd = await event.request.formData();
			const row = await getPartnerInvoice(db, partner.id, String(fd.get('invoice_id') ?? ''));
			if (!row || row.facility_id !== partner.facility_id) throw new PartnerStoreError('請求書が見つかりません。', 404, 'not_found');
			const r = await sendPartnerInvoiceMail(db, partner, row, event.url.origin);
			return {
				invoiceResult: r.sent
					? { kind: 'sent' as const, message: `${row.invoice_no} を ${r.to.join(', ')} へ送信しました${r.attachedPdf ? '（PDF 添付）' : '（PDF なし・ページへ案内）'}。` }
					: { kind: 'error' as const, message: `${row.invoice_no} を送信できませんでした（${r.reason}）。` }
			};
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 請求書の取消（理由必須）。取り消すと同じ月を発行し直せる
	voidInvoice: async (event) => {
		try {
			const { db, partner, userId } = await editScope(event);
			const fd = await event.request.formData();
			const row = await voidPartnerInvoice(db, partner, String(fd.get('invoice_id') ?? ''), String(fd.get('reason') ?? ''), userId);
			return { invoiceResult: { kind: 'voided' as const, message: `${row.invoice_no} を取り消しました。` } };
		} catch (e) {
			return actionFailure(e);
		}
	},

	issueKey: async (event) => {
		try {
			const { db, partner, userId } = await editScope(event);
			const fd = await event.request.formData();
			const label = String(fd.get('label') ?? '').trim().slice(0, 80) || null;
			const { key } = await issuePartnerApiKey(db, partner, label, userId);
			return { apiKey: key };
		} catch (e) {
			return actionFailure(e);
		}
	},

	revokeKey: async (event) => {
		try {
			const { db, partner } = await editScope(event);
			const fd = await event.request.formData();
			await revokePartnerApiKey(db, partner, String(fd.get('key_id') ?? ''));
			return { keyRevoked: true };
		} catch (e) {
			return actionFailure(e);
		}
	}
};
