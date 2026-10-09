// 管理画面: 取引先の詳細（限定URL・覚書・公開設定・特別レート・予約受付・プレビュー・予約・請求書・ログインID・API キー・アクセスログ）。
// autumn-rms の /partners/[id]（v0.103.0）から移設（2026-09-26）。
// 閲覧は admin / staff、操作（保存・再発行・発行・取消と返金・再請求・削除・請求書の発行・再送・取消）は admin のみ（staff.ts の canEditPartners）。
// PMS の顧客マスタとの紐づけ（2026-10-07・Phase 1）: 候補の検索は閲覧権限で、紐づけ・解除は admin のみ。
// 予約名義（2026-10-07・Phase 2）: 紐づけ済みのときだけ選べる。変更は admin のみ（setBookingNameMode）。
// 与信（2026-10-07・Phase 3a）: 紐づけ先が旅行会社のときだけ。表示は閲覧権限、設定の保存（saveAgencyCredit）と
// 超過時の挙動（setCreditOverAction）は admin のみ。
// デポジット（2026-10-07・Phase 3b）: 超過時の挙動 deposit の額の決め方・残額の精算先（setCreditDeposit・admin のみ）。
// 複数施設化 S3（2026-10-09・docs/partner-multi-facility.md §7.12）: 共通セクション（?/saveCommon）と施設タブ（?/saveFacility・
// ?/enableFacility）に分けた。施設タブは ?fac=<Book の施設 ID>（既定は ab_fac の施設）。取引先は施設のどれかにアクセスできれば
// 開ける（ab_fac を切り替えても一覧へ戻さない）。施設タブの操作は requireStaffFacility（Book の施設・アクセス）を通す。
import { partnerSavedCardSummary } from '$lib/server/payments/saved-cards';
import type { SupabaseClient } from '@supabase/supabase-js';
import { redirect, type RequestEvent } from '@sveltejs/kit';
import { ADVANCE_PLAN_CODE, isRetiredPlanName } from '$lib/partner-pricing';
import {
	buildPartnerFacilitySettings,
	depositRemainderModeOf,
	describeBooker,
	normalizeBooker,
	normalizeCreditDeposit,
	normalizeCreditDepositRemainder,
	normalizePartnerBookingSettings,
	PARTNER_FACILITY_SETTING_KEYS,
	readPartnerFacilityOverrides,
	type PartnerFacilityOwnSettings
} from '$lib/partner-booking';
import { friendlyId } from '$lib/server/partners/crypto';
import { countBookingAttachments, partnerBookingAttachmentsEnabled } from '$lib/server/partners/booking-attachments';
import { loadPartnerRankStatus, loadPartnerRates, rmsPartnerRatesUrl, type PartnerPriceMode, type PartnerPriceSource } from '$lib/server/partners/rates';
import { describePublishableKeyIssue } from '$lib/server/payments/keys';
import { publishableKeyProblem } from '$lib/server/stripe';
import {
	cancelPartnerBooking,
	depositSummary,
	isPartnerBookingOpen,
	isStripeTestMode,
	bookingNameLineOf,
	listPartnerBookings,
	parseStaffFeeForm,
	previewPartnerCancels,
	cancelFeeBasisLabel,
	cancelFeeSettlementLabel,
	cancelKeptNote,
	inlinePaymentReady,
	onlinePaymentReady,
	retryPartnerCharge,
	stripeKeyHint,
	stripeKeyKind
} from '$lib/server/partners/booking';
import {
	addDaysIso,
	bookFacilityMeta,
	createPartnerAccount,
	deletePartner,
	deletePartnerAccount,
	getAgencyCreditState,
	getPmsPartnerGuest,
	issuePartnerApiKey,
	partnerCreditCheck,
	setAgencyCredit,
	setPartnerCreditOverAction,
	setPartnerCreditDeposit,
	listPartnerAccessLogs,
	listPartnerAccounts,
	listPartnerApiKeys,
	PARTNER_KIND_LABELS,
	PartnerStoreError,
	regeneratePartnerUrl,
	reissueSetupToken,
	revokePartnerApiKey,
	savePartnerFacility,
	searchPmsPartnerGuests,
	setPartnerBookingNameMode,
	setPartnerPmsGuest,
	todayJst,
	updatePartnerAccount,
	updatePartnerCommon,
	type StaffPartnerView
} from '$lib/server/partners/store';
import {
	actionFailure,
	partnerPortalUrl,
	requireCommonEditAccess,
	requireStaffFacility,
	resolveBookFacility,
	sendSetupEmail,
	staffHasFacilityAccess,
	staffPartnerScope,
	staffPartnerView,
	StaffScopeError
} from '$lib/server/partners/staff';
import { isEmail, parsePartnerCommonForm, parsePartnerFacilityForm } from '$lib/server/partners/staff-form';
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
import { isPartnerBilledBooking, periodOf } from '$lib/partner-invoice';
import { photoFileProblem } from '$lib/content-blocks';
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbUploadContentPhoto } from '$lib/server/content-admin';
import { BOOKING_NAME_MODES, pmsGuestCreditUrl, pmsGuestUrl, type BookingNameMode } from '$lib/pms-partner-guest';
import {
	bookActorUserId,
	creditOverLine,
	creditUpdatedSource,
	isCreditOver,
	isSelectableCreditOverAction,
	nextMonths,
	parseCreditSettingsInput
} from '$lib/partner-credit';
import type { Actions, PageServerLoad } from './$types';

const PREVIEW_DAYS = 14;

type PlanOption = { code: string; label: string; mealType: string | null };

// 施設のプラン一覧（プラングループ単位・「プラン名（取引先向け）」・特典の対象プラン・特別レートの要約の名前）。
// booking.rate_plans は Data API に出していないので、book.v_admin_rate_plans（security_invoker・authenticated）を
// ログイン中のスタッフのクライアントで読む（service_role には権限が無い）。読めなければ null（呼び出し側でプレビューのプランで補う）
async function loadFacilityPlanOptions(event: RequestEvent, facilityId: string): Promise<PlanOption[] | null> {
	try {
		const { data, error } = await createSupabaseServerClient(event)
			.schema('book')
			.from('v_admin_rate_plans')
			.select('code, meal_plan, is_active')
			.eq('facility_id', facilityId)
			.eq('is_active', true);
		if (error) return null;
		const map = new Map<string, PlanOption>();
		for (const r of (data ?? []) as { code: string | null; meal_plan: string | null }[]) {
			const code = String(r.code ?? '');
			const i = code.indexOf('■');
			if (i <= 0) continue;
			const group = code.slice(0, i);
			const label = code.slice(i + 1);
			if (map.has(group) || isRetiredPlanName(label)) continue;
			map.set(group, { code: group, label, mealType: r.meal_plan ?? null });
		}
		return [...map.values()];
	} catch {
		return null;
	}
}

// 保存済みの最終料金の計算状態（rms_partner_price_state・service_role）。読めなければ null
type PriceState = {
	priceSource: string | null;
	computedFrom: string | null;
	computedTo: string | null;
	rowCount: number;
	durationMs: number | null;
	computedAt: string | null;
	error: string | null;
};
async function loadPriceState(db: SupabaseClient, partnerId: string, facilityId: string): Promise<PriceState | null> {
	const { data, error } = await db
		.from('rms_partner_price_state')
		.select('price_source, computed_from, computed_to, row_count, duration_ms, computed_at, error')
		.eq('partner_id', partnerId)
		.eq('facility_id', facilityId)
		.maybeSingle();
	if (error || !data) return null;
	const r = data as Record<string, unknown>;
	return {
		priceSource: (r.price_source as string | null) ?? null,
		computedFrom: (r.computed_from as string | null) ?? null,
		computedTo: (r.computed_to as string | null) ?? null,
		rowCount: Number(r.row_count ?? 0),
		durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
		computedAt: (r.computed_at as string | null) ?? null,
		error: (r.error as string | null) ?? null
	};
}

export const load: PageServerLoad = async (event) => {
	let scope;
	try {
		scope = await staffPartnerScope(event, 'view');
	} catch (e) {
		// 使えない環境・権限なしは一覧で理由を出す
		if (e instanceof StaffScopeError) redirect(303, '/admin/partners');
		throw e;
	}
	// 施設タブ: ?fac=<Book の施設 ID>（既定は ab_fac の施設）。アクセスできない施設なら ab_fac の施設に戻す
	const asked = resolveBookFacility(event.url.searchParams.get('fac'));
	const tabFacility =
		asked && (asked.facilityId === scope.facilityId || (await staffHasFacilityAccess(event, asked.facilityId)))
			? asked
			: { bookFacilityId: scope.bookFacilityId, facilityId: scope.facilityId, name: scope.facilityName };
	let view: StaffPartnerView;
	try {
		view = await staffPartnerView(event, scope, event.params.id, tabFacility.facilityId);
	} catch (e) {
		// 見られない取引先（アクセスできる施設に設定が無い・別テナント）・存在しない ID は一覧へ
		if (e instanceof PartnerStoreError) redirect(303, '/admin/partners');
		throw e;
	}
	// 合成はタブの施設（行が無ければ販売しない既定値で補ったもの）
	const partner = view.partner;
	const row = view.row;
	const facilityTabs = await loadFacilityTabs(event, scope, view);

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
		// プレビュー: 保存済みの最終料金（取引先に見える価格）と特別レート前の料金（2026-10-09 §7）。取引先ページと同じ読み出し
		// （保存済みが無ければ従来の計算）。公開停止中でも見られるように、取引先の公開状態は見ない。施設で販売していなければ作らない
		(row
			? loadPartnerRates(scope.db, { ...partner, show_inventory: true }, { from: previewFrom, to: previewTo }, { includeBase: true })
			: Promise.reject(new Error('この施設では販売していません。'))
		)
			.then((r) => ({ ...r, error: null as string | null }))
			.catch((e) => ({
				days: [],
				rooms: [] as { roomCode: string; name: string }[],
				planOptions: [] as PlanOption[],
				priceSource: null as PartnerPriceSource | null,
				priceMode: null as PartnerPriceMode | null,
				computedAt: null as string | null,
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

	// 料金の元（取引先ランク暦 / TL のランク）と暦の未設定日（2026-10-09・docs/partner-rank-rates.md §5.4）・
	// 保存済みの最終料金の計算状態（§7）・施設のプラン一覧。読めなければ出さない
	const [rankStatus, priceState, facilityPlans] = await Promise.all([
		row ? loadPartnerRankStatus(scope.db, partner, today).catch(() => null) : Promise.resolve(null),
		row ? loadPriceState(scope.db, partner.id, partner.facility_id).catch(() => null) : Promise.resolve(null),
		loadFacilityPlanOptions(event, partner.facility_id)
	]);

	// 与信（受付枠・Phase 3a）: 紐づけ先が旅行会社のときだけ読む（法人・未紐づけでは出さない）
	const credit = pmsGuest.guest?.guestType === 'group' ? await loadCreditSection(event, scope, partner, today) : null;

	// プランの選択肢（プラン名・特典・特別レートの要約）。施設のプラン一覧（booking.rate_plans）を正とし、読めなければ
	// プレビューに出たプランで補う（同じコードが部屋タイプ間で共通なので、コード単位でまとめる）。保存済みルールにしか無いコードも残す。
	const planMap = new Map((facilityPlans ?? preview.planOptions).map((p) => [p.code, p]));
	for (const p of preview.planOptions) if (!planMap.has(p.code)) planMap.set(p.code, p);
	const roomMap = new Map(preview.rooms.map((r) => [r.roomCode, { code: r.roomCode, name: r.name }]));
	for (const rule of partner.pricing.rules) {
		for (const code of rule.planGroupCodes) {
			if (code !== ADVANCE_PLAN_CODE && !planMap.has(code)) planMap.set(code, { code, label: code, mealType: null });
		}
		for (const code of rule.roomCodes) if (!roomMap.has(code)) roomMap.set(code, { code, name: code });
	}
	const planOptions = [...planMap.values()].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));

	const accountLabel = new Map(accounts.map((a) => [a.id, a.login_id]));
	const facilityNames = new Map(facilityTabs.map((t) => [t.facilityId, t.name]));
	const facilityNameOf = (id: string | null | undefined) => (id ? (facilityNames.get(id) ?? '') : '');
	const keyLabel = new Map(apiKeys.map((k) => [k.id, k.label || k.key_prefix]));
	const origin = event.url.origin;

	// 取消フォームに出すキャンセル料の見込み（確定済み・未チェックインの予約）
	const cancelPreviews = await previewPartnerCancels(scope.db, partner.facility_id, bookings).catch(() => ({}) as Awaited<ReturnType<typeof previewPartnerCancels>>);
	// 取引先のお支払いカード（保存カード・2026-10-07）の枚数と最終登録（読むだけ・問い合わせ対応用・N10）。読めなければ出さない
	const savedCards = onlinePaymentReady() ? await partnerSavedCardSummary(scope.db, partner).catch(() => null) : null;
	// 予約ごとの添付ファイルの件数（📎 N・2026-10-07）。操作は予約管理の詳細に集める。機能が off・読めなければ空
	const attachmentCounts = partnerBookingAttachmentsEnabled()
		? await countBookingAttachments(scope.db, partner.id, bookings.map((b) => b.id))
		: new Map<string, number>();
	return {
		facilityName: scope.facilityName,
		facilitySlugHint: scope.bookFacilityId === 'f-oga' ? 'oga' : 'yamado',
		// 施設タブ（Book の施設のうちスタッフがアクセスできるもの）と、選んでいるタブ
		facilityTabs,
		tab: {
			id: tabFacility.bookFacilityId,
			facilityId: tabFacility.facilityId,
			name: partner.facility_name || tabFacility.name,
			slug: partner.facility_slug,
			hasRow: !!row,
			isCurrent: tabFacility.facilityId === scope.facilityId
		},
		// 施設タブの設定（この施設に行が無ければ null =「この施設では販売していません」）
		facility: row
			? {
					enabled: row.enabled,
					bookingEnabled: row.booking_enabled,
					maxDaysAhead: row.max_days_ahead,
					showInventory: row.show_inventory,
					includeAdvance: row.include_advance,
					pricing: row.pricing,
					sortOrder: row.sort_order,
					// 施設ごとのキー（取引先ページに出ている値。施設に無いキーは共通の旧い値で補われる）
					own: Object.fromEntries(PARTNER_FACILITY_SETTING_KEYS.map((k) => [k, partner.booking_settings[k]])) as PartnerFacilityOwnSettings,
					// N6 の上書き（キーがあるものだけ）
					overrides: readPartnerFacilityOverrides(row.facility_settings),
					bookingOpen: isPartnerBookingOpen(partner),
					updatedAt: row.updated_at
				}
			: null,
		// 「確認ページを開く」: タブの施設で開く（取引先ページは ?f=<slug> のオンの施設を選ぶ）
		previewUrl: `/admin/partners/${partner.id}/preview?f=${encodeURIComponent(partner.facility_slug)}`,
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
			note: partner.note,
			// 共通の予約設定（rms_partners.booking_settings だけを正規化したもの。N6 の既定を含む）
			commonSettings: normalizePartnerBookingSettings(partner.common_settings),
			// タブの施設で合成した設定（請求書の欄の説明など。請求条件のキーは共通）
			bookingSettings: partner.booking_settings,
			updatedAt: partner.updated_at
		},
		portalUrl: partnerPortalUrl(origin, partner.url_token),
		// PMS の顧客マスタ（旅行会社・法人）との紐づけ。guestId があるのに guest が null = 紐づけ先が見つからない（統合・種別変更など）
		pmsLink: {
			guestId: partner.pms_guest_id,
			guest: pmsGuest.guest ? { ...pmsGuest.guest, url: pmsGuestUrl(pmsGuest.guest.id) } : null,
			error: pmsGuest.error,
			// 予約名義（Phase 2）。紐づけが無ければ DB のトリガーで常に guest
			bookingNameMode: partner.booking_name_mode,
			// 与信（Phase 3a）。紐づけ先が旅行会社でなければ null（セクションを出さない）
			credit,
			creditOverAction: partner.credit_over_action,
			// デポジット（Phase 3b）: 額の決め方・残額の精算先（null＝既定）と、既定のときの精算先
			creditDeposit: partner.booking_settings.creditDeposit,
			creditDepositRemainder: partner.booking_settings.creditDepositRemainder,
			creditDepositRemainderDefault: depositRemainderModeOf({ ...partner.booking_settings, creditDepositRemainder: null })
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
		// API の facility（オンの施設の slug・2つ以上なら必須・複数施設化 S5b・2026-10-09）
		apiFacilities: view.bundle.facilities.filter((f) => !f.synthetic && f.enabled).map((f) => f.slug),
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
		savedCards,
		stripeKeyKind: stripeKeyKind(),
		stripeKeyHint: stripeKeyKind() === 'invalid' ? stripeKeyHint() : null,
		bookings: bookings.map((b) => ({
			// キャンセル料の見込み（取消フォーム）と、取消済みのキャンセル料
			cancelPreview: cancelPreviews[b.id] ?? null,
			cancelFee:
				b.status === 'cancelled' && b.cancel_fee_settlement
					? { fee: b.cancel_fee ?? 0, waived: !!b.cancel_fee_waived, basis: cancelFeeBasisLabel(b), settlement: cancelFeeSettlementLabel(b).replace(/^→ /, ''),
						kept: cancelKeptNote(b), status: b.cancel_fee_status ?? null, error: b.cancel_fee_error ?? null, note: b.cancel_fee_note ?? null }
					: null,
			invoiceMonth: `${Number(b.check_out_date.slice(0, 4))}年${Number(b.check_out_date.slice(5, 7))}月`,
			hasCard: b.payment_option === 'online_checkin' && !!b.stripe_payment_method_id && (b.payment_status === 'scheduled' || b.payment_status === 'charge_failed'),
			id: b.id,
			code: b.booking_code,
			// 予約の施設（取消・再請求は予約の施設で合成し直す・contextForBooking）
			facilityId: b.facility_id,
			facilityName: facilityNameOf(b.facility_id),
			attachmentCount: attachmentCounts.get(b.id) ?? 0,
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
			// 予約時に受付枠（与信）を超えていた予約（Phase 3a）。超過した月の内訳はツールチップに
			creditOver: isCreditOver(b.credit_result),
			creditOverText: creditOverLine(b.credit_result),
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
			billedToPartner: isPartnerBilledBooking(b, partner.booking_settings),
			// デポジット予約（Phase 3b）: 「デポジット ○円 お支払い済み・残額 ○円（請求書／現地）」
			depositText: depositSummary(b),
			cardLabel: b.card_label,
			chargeError: b.charge_error,
			refundError: b.refund_error,
			...bookingExtras(b.detail)
		})),
		preview: { from: previewFrom, to: previewTo, days: preview.days, error: preview.error, priceMode: preview.priceMode, computedAt: preview.computedAt },
		// 保存済みの最終料金の計算状態（rms_partner_price_state）。行が無い・読めなければ null
		priceState,
		// 料金の元: 暦の設定（rankStatus）を優先し、読めなければプレビューの RPC が返した priceSource
		priceSource: {
			source: rankStatus ? (rankStatus.enabled ? 'partner_rank' : 'standard') : preview.priceSource,
			publicDays: rankStatus?.publicDays ?? null,
			missingDays: rankStatus?.missingDays ?? null,
			rmsUrl: rmsPartnerRatesUrl(partner.id, partner.facility_slug)
		},
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

// 管理画面の表に出す月数（今月から）
const CREDIT_TABLE_MONTHS = 12;

// 与信（受付枠）のセクション: 設定（PMS の metadata.pms の4キー・楽観ロック用の updated_at）・最終更新・今後 12 か月の判定。
// 読めなくても他の欄は出す（error に理由）。
async function loadCreditSection(
	event: RequestEvent,
	scope: Awaited<ReturnType<typeof staffPartnerScope>>,
	partner: StaffPartnerView['partner'],
	today: string
) {
	const guestId = partner.pms_guest_id as string;
	try {
		const [state, check] = await Promise.all([
			getAgencyCreditState(scope.db, partner.tenant_id, guestId),
			partnerCreditCheck(scope.db, partner, nextMonths(today.slice(0, 7), CREDIT_TABLE_MONTHS))
		]);
		if (!state) return null;
		return {
			state: {
				enabled: state.enabled,
				growthRate: state.growthRate,
				minRooms: state.minRooms,
				note: state.note,
				// 楽観ロック: 保存時にこの値を送り、違えば「他の人が先に変えました」
				guestUpdatedAt: state.guestUpdatedAt
			},
			updatedAt: state.updatedAt,
			updatedSource: creditUpdatedSource(state.updatedBy, await bookActorName(event, scope, state.updatedBy)),
			months: check?.enabled ? check.months : [],
			pmsCreditUrl: pmsGuestCreditUrl(guestId),
			error: null as string | null
		};
	} catch (e) {
		return {
			state: null,
			updatedAt: null,
			updatedSource: '',
			months: [],
			pmsCreditUrl: pmsGuestCreditUrl(guestId),
			error: e instanceof Error ? e.message : String(e)
		};
	}
}

// 「最終更新」の誰: credit_updated_by = 'book:<user id>' のスタッフ名（自分なら自分の名前、他の人は Auth の表示名・メール）。
// 引けなければ null（「book」とだけ出す）
async function bookActorName(event: RequestEvent, scope: Awaited<ReturnType<typeof staffPartnerScope>>, updatedBy: string | null): Promise<string | null> {
	const id = bookActorUserId(updatedBy);
	if (!id) return null;
	if (id === scope.userId) return event.locals.user?.name || null;
	try {
		const { data } = await scope.db.auth.admin.getUserById(id);
		const u = data?.user;
		if (!u) return null;
		const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
		const name = [meta.name, meta.full_name, meta.display_name].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
		return name?.trim() || u.email || null;
	} catch {
		return null;
	}
}

// 施設タブ（複数施設化 S3）: Book の施設すべて（施設名・slug）と、スタッフがアクセスできるか・取引先の設定（オン／オフ・予約受付）
async function loadFacilityTabs(event: RequestEvent, scope: Awaited<ReturnType<typeof staffPartnerScope>>, view: StaffPartnerView) {
	const metas = await bookFacilityMeta(scope.db);
	return Promise.all(
		metas.map(async (m) => {
			const row = view.bundle.facilities.find((f) => f.facility_id === m.id && !f.synthetic) ?? null;
			return {
				id: resolveBookFacility(m.id)?.bookFacilityId ?? m.id,
				facilityId: m.id,
				slug: m.slug,
				name: m.name,
				accessible: m.id === scope.facilityId || (await staffHasFacilityAccess(event, m.id)),
				hasRow: !!row,
				enabled: row?.enabled ?? false,
				bookingEnabled: !!row && row.enabled && row.booking_enabled,
				isCurrent: m.id === scope.facilityId
			};
		})
	);
}

// 各アクション共通: 編集権限（admin）・取引先を見られるか（施設のどれかにアクセスできる）を確かめる。
// facilityId は「取引先に施設設定の行がある施設」（ab_fac の施設を優先）に差し替える（store の紐づけ・与信などの関数は
// その施設で取引先の所属を確かめ直すため）。ab_fac の施設そのものは scopeFacilityId。
async function editScope(event: RequestEvent) {
	const scope = await staffPartnerScope(event, 'edit');
	const view = await staffPartnerView(event, scope, event.params.id ?? '');
	const partnerFacilityId = view.row?.facility_id ?? view.bundle.facilities.find((f) => !f.synthetic)?.facility_id ?? scope.facilityId;
	return { ...scope, scopeFacilityId: scope.facilityId, facilityId: partnerFacilityId, view, partner: view.partner };
}

// 共通設定（名前・支払条件・紐づけ・与信・覚書など）の操作: 取引先のオンの施設すべてにアクセスできる管理者だけ（§7.7）
async function commonScope(event: RequestEvent) {
	const s = await editScope(event);
	await requireCommonEditAccess(event, { ...s, facilityId: s.scopeFacilityId }, s.view);
	return s;
}

// 施設タブの操作: 施設が Book の施設で、スタッフがアクセスできること（requireStaffFacility）・取引先を見られること
async function facilityScope(event: RequestEvent, facilityRef: string | null | undefined) {
	const scope = await staffPartnerScope(event, 'edit');
	const fac = await requireStaffFacility(event, scope, facilityRef);
	const view = await staffPartnerView(event, scope, event.params.id ?? '', fac.facilityId);
	return { ...scope, fac, view, partner: view.partner };
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
			const { partner } = await staffPartnerView(event, scope, event.params.id ?? '');
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
			const { db, facilityId, partner, userId } = await commonScope(event);
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
			const { db, facilityId, partner, userId } = await commonScope(event);
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
			const { db, facilityId, partner, userId } = await commonScope(event);
			const raw = String((await event.request.formData()).get('mode') ?? '');
			if (!(BOOKING_NAME_MODES as readonly string[]).includes(raw)) return actionFailure(new PartnerStoreError('予約名義の指定が正しくありません。'));
			const saved = await setPartnerBookingNameMode(db, facilityId, partner.id, raw as BookingNameMode, userId);
			return { bookingNameMode: saved.booking_name_mode };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 与信の設定（Phase 3a・決定 #7・N4）。管理者だけ（editScope が admin を確かめる。スタッフは 403）。
	// 紐づけ・名義と同じく専用アクションで即時保存。metadata.pms の4キーだけを DB 関数で部分更新し、
	// 画面に出した時点の core.guests.updated_at が変わっていれば保存しない（他の人・PMS が先に変えた）。
	saveAgencyCredit: async (event) => {
		try {
			const { db, facilityId, partner, userId } = await commonScope(event);
			const fd = await event.request.formData();
			const parsed = parseCreditSettingsInput({
				enabled: String(fd.get('enabled') ?? ''),
				growthRate: fd.get('growth_rate'),
				minRooms: fd.get('min_rooms'),
				note: fd.get('note')
			});
			if (!parsed.ok) return actionFailure(new PartnerStoreError(parsed.message));
			const expected = String(fd.get('expected_updated_at') ?? '').trim() || null;
			const r = await setAgencyCredit(db, facilityId, partner.id, parsed.patch, userId, expected);
			if (r.result === 'conflict') {
				return actionFailure(new PartnerStoreError('他の人が先に変えました。読み直してください。', 409, 'conflict'));
			}
			return { agencyCreditSaved: true };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 超過時の挙動（deposit / warn / ignore）。選んだ時点で保存
	setCreditOverAction: async (event) => {
		try {
			const { db, facilityId, partner, userId } = await commonScope(event);
			const raw = String((await event.request.formData()).get('action') ?? '');
			if (!isSelectableCreditOverAction(raw)) return actionFailure(new PartnerStoreError('超過時の挙動の指定が正しくありません。'));
			const saved = await setPartnerCreditOverAction(db, facilityId, partner.id, raw, userId);
			return { creditOverAction: saved.credit_over_action };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// デポジット（Phase 3b・取引先ごと）: 額の決め方（定率％／1室あたり円／1泊分）と残額の精算先（既定／請求書／現地）。管理者だけ
	setCreditDeposit: async (event) => {
		try {
			const { db, facilityId, partner, userId } = await commonScope(event);
			const fd = await event.request.formData();
			const type = String(fd.get('type') ?? '');
			if (type !== 'percent' && type !== 'yen_per_room' && type !== 'first_night') {
				return actionFailure(new PartnerStoreError('デポジットの額の決め方を選んでください。'));
			}
			const raw = String(fd.get('value') ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[,，％%円\s]/g, '');
			if (type !== 'first_night') {
				const n = Number(raw);
				const max = type === 'percent' ? 100 : 1_000_000;
				if (!/^\d+$/.test(raw) || n < 1 || n > max) {
					return actionFailure(new PartnerStoreError(type === 'percent' ? '定率は 1〜100 の整数で入力してください（％）。' : '1室あたりの額は 1〜1,000,000 の整数で入力してください（円）。'));
				}
			}
			const remainderRaw = String(fd.get('remainder') ?? '');
			const saved = await setPartnerCreditDeposit(
				db,
				facilityId,
				partner.id,
				{ deposit: normalizeCreditDeposit({ type, value: Number(raw) }), remainder: normalizeCreditDepositRemainder(remainderRaw) },
				userId
			);
			return { creditDeposit: saved.booking_settings.creditDeposit };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 共通セクションの保存（複数施設化 S3・2026-10-09）: 名前・公開・連絡先・社内メモと、共通の予約設定（支払方法・請求条件・
	// 毎回聞く項目・取引先への通知・早期決済割と受付ルールの既定〔N6〕）。施設の行には触らない（施設タブの未保存の編集を消さない）
	saveCommon: async (event) => {
		try {
			const { db, partner, userId, view } = await commonScope(event);
			const input = parsePartnerCommonForm(await event.request.formData());
			// デポジットの設定は専用のアクション（setCreditDeposit）で保存する。画面に残った古い値で上書きしないよう、今の DB の値を残す
			const current = normalizePartnerBookingSettings(partner.common_settings);
			input.booking_settings = {
				...input.booking_settings,
				creditDeposit: current.creditDeposit,
				creditDepositRemainder: current.creditDepositRemainder
			};
			// 予約を受け付けている施設があるときは、支払方法が要る
			const accepting = view.bundle.facilities.filter((f) => !f.synthetic && f.enabled && f.booking_enabled);
			if (accepting.length && !input.booking_settings.paymentOptions.length) {
				throw new PartnerStoreError(`予約を受け付けている施設（${accepting.map((f) => f.name).join('・')}）があるため、支払方法を1つ以上選んでください。`);
			}
			await updatePartnerCommon(db, partner, userId, input);
			return { commonSaved: true };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 施設タブの保存（複数施設化 S3）: hidden の facility_id の施設の行（rms_partner_facilities）だけを書く。
	// N6 の上書きはキーの有無（「共通の既定を使う」はキーを消す）。共通の設定には触らない
	saveFacility: async (event) => {
		try {
			const fd = await event.request.formData();
			const input = parsePartnerFacilityForm(fd);
			const { db, userId, fac, view } = await facilityScope(event, input.facilityRef);
			if (!view.row) throw new PartnerStoreError(`${fac.name}では販売していません。先に「この施設で販売する」でオンにしてください。`, 409, 'facility_off');
			if (input.patch.enabled && input.patch.booking_enabled && !normalizePartnerBookingSettings(view.partner.common_settings).paymentOptions.length) {
				throw new PartnerStoreError('予約を受け付けるときは、共通の「支払方法」を1つ以上選んで保存してください。');
			}
			await savePartnerFacility(
				db,
				view.partner,
				fac.facilityId,
				{ ...input.patch, facility_settings: buildPartnerFacilitySettings(view.row.facility_settings, input.own, input.overrides) },
				userId
			);
			return { facilitySaved: fac.bookFacilityId };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 施設タブの「この施設で販売する」: 行が無ければ作り（オン・予約受付はオフ・料金ルールなし）、オフならオンにする
	enableFacility: async (event) => {
		try {
			const fd = await event.request.formData();
			const { db, userId, fac, view } = await facilityScope(event, String(fd.get('facility_id') ?? ''));
			if (!view.row) {
				await savePartnerFacility(db, view.partner, fac.facilityId, { enabled: true, booking_enabled: false }, userId);
			} else if (!view.row.enabled) {
				await savePartnerFacility(db, view.partner, fac.facilityId, { enabled: true }, userId);
			}
			return { facilityEnabled: fac.bookFacilityId };
		} catch (e) {
			return actionFailure(e);
		}
	},

	// 覚書の本文（取引条件のまとめ）。取引先ページの「覚書」にそのまま出る
	saveMemorandum: async (event) => {
		try {
			const { db, partner, userId } = await commonScope(event);
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
	// 特典は施設ごと（§4.2）: hidden の facility_id の施設の行の perks を書き、画像は施設の置き場（partners/{施設UUID}/…）へ。
	uploadPerkImage: async (event) => {
		try {
			const fd = await event.request.formData();
			const { db, userId, fac, view } = await facilityScope(event, String(fd.get('facility_id') ?? ''));
			if (!view.row) throw new PartnerStoreError(`${fac.name}では販売していません。`, 409, 'facility_off');
			const perkId = String(fd.get('perk_id') ?? '');
			let url = '';
			if (fd.get('remove') !== '1') {
				const file = fd.get('photo');
				const problem = photoFileProblem(file instanceof File ? file : null);
				if (problem) return actionFailure(new PartnerStoreError(problem));
				url = await sbUploadContentPhoto(createSupabaseServerClient(event), 'partners', fac.facilityId, file as File);
			}
			// 施設の行に特典があるときだけその場で保存する（共通の旧い値で補った特典は「保存する」で施設へ確定）
			const saved = normalizePartnerBookingSettings(view.row.facility_settings).perks;
			const persisted = Array.isArray(view.row.facility_settings.perks) && saved.some((p) => p.id === perkId);
			if (persisted) {
				const perks = saved.map((p) => (p.id === perkId ? { ...p, imageUrl: url } : p));
				await savePartnerFacility(db, view.partner, fac.facilityId, { facility_settings: { ...view.row.facility_settings, perks } }, userId);
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
			const { db, partner, userId } = await commonScope(event);
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

	// チェックアウト日決済の再請求（請求失敗・チェックアウト日を迎えた請求予定）
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
			const { db, partner } = await commonScope(event);
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
			// 請求書は取引先ごと（全施設分1枚・N3・2026-10-09）。施設では絞らない
			if (!row) throw new PartnerStoreError('請求書が見つかりません。', 404, 'not_found');
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
