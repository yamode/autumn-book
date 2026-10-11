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
// 読み込みの分担（2026-10-10・施設タブの切替を軽くする）: 施設に関係しない読み込みは ./+layout.server.ts（?fac= を読まないので
// タブの切替ではやり直さない）。この load は施設タブの分だけで、プレビュー・料金の元・計算の状態は後から流す（previewInfo）。
// 特別会員の専用ページ（kind='member'・2026-10-11・docs/vip-member-page.md §13.4.5）: isMemberPage・対象の会員（members・
// ?/addMember・?/removeMember・?/searchMembers・admin のみ）・施設タブのキャンセル方式と規定（facility.cancelPolicy・
// ?/saveFacility の facility_booking に cancelPolicyMode / cancelRules）・最大室数は 1〜4。支払方法は要らない（公式予約の支払方法）。
import type { SupabaseClient } from '@supabase/supabase-js';
import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { isMemberPage, memberMaxRooms } from '$lib/partner-member-page';
import { adminFindMembers, bookAdmin, linkMemberErrorText } from '$lib/server/admin-app-data';
import { ADVANCE_PLAN_CODE, isRetiredPlanName } from '$lib/partner-pricing';
import {
	buildPartnerFacilitySettings,
	normalizeCreditDeposit,
	normalizeCreditDepositRemainder,
	normalizePartnerBookingSettings,
	PARTNER_FACILITY_MEMBER_KEYS,
	PARTNER_FACILITY_SETTING_KEYS,
	readPartnerFacilityOverrides,
	type PartnerFacilityOwnSettings
} from '$lib/partner-booking';
import { friendlyId } from '$lib/server/partners/crypto';
import { loadPartnerRankStatus, loadPartnerRates, rmsPartnerRatesUrl, type PartnerPriceMode, type PartnerPriceSource } from '$lib/server/partners/rates';
import { describePublishableKeyIssue } from '$lib/server/payments/keys';
import { publishableKeyProblem } from '$lib/server/stripe';
import {
	cancelPartnerBooking,
	isPartnerBookingOpen,
	isStripeTestMode,
	parseStaffFeeForm,
	inlinePaymentReady,
	onlinePaymentReady,
	retryPartnerCharge,
	stripeKeyHint,
	stripeKeyKind
} from '$lib/server/partners/booking';
import {
	addDaysIso,
	addPartnerMember,
	bookFacilityMeta,
	listPartnerMembers,
	removePartnerMember,
	createPartnerAccount,
	deletePartner,
	deletePartnerAccount,
	issuePartnerApiKey,
	partnerCreditCheck,
	setAgencyCredit,
	setPartnerCreditOverAction,
	setPartnerCreditDeposit,
	PARTNER_KIND_LABELS,
	PartnerStoreError,
	regeneratePartnerUrl,
	reissueSetupToken,
	resetAccountMfa,
	revokeAllSessionsByStaff,
	revokePartnerApiKey,
	setPartnerMfaPolicy,
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
import { listRecentGroupInquiriesOfPartner } from '$lib/server/partners/group-inquiries';
import {
	deletePartnerDocument,
	PARTNER_DOCUMENT_ACCEPT,
	savePartnerMemorandum,
	uploadPartnerDocument
} from '$lib/server/partners/memorandum';
import {
	issuePartnerInvoice,
	normalizePeriod,
	getPartnerInvoice,
	sendPartnerInvoiceMail,
	voidPartnerInvoice
} from '$lib/server/partners/invoices';
import { photoFileProblem } from '$lib/content-blocks';
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbUploadContentPhoto } from '$lib/server/content-admin';
import { BOOKING_NAME_MODES, pmsGuestUrl, type BookingNameMode } from '$lib/pms-partner-guest';
import { isSelectableCreditOverAction, nextMonths, parseCreditSettingsInput } from '$lib/partner-credit';
import { requestMeta } from '$lib/server/partners/portal';
import { normalizeMfaPolicy, PARTNER_MFA_POLICIES, PARTNER_MFA_POLICY_LABELS, type PartnerMfaPolicy } from '$lib/partner-mfa';
import type { Actions, PageServerLoad } from './$types';

const PREVIEW_DAYS = 14;
// 与信の月別の判定を出す月数（今月から）
const CREDIT_TABLE_MONTHS = 12;

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

// 施設タブ（?fac=）の読み込み（2026-10-10・施設タブの切替を軽くする）。施設に関係しないもの（ログインID・API キー・覚書・
// ファイル・PMS の顧客・予約一覧・アクセスログ・請求書・保存カード）は ./+layout.server.ts へ分けた（タブの切替ではやり直さない）。
// ここで待つのは、認証・リダイレクト・施設タブ・施設の設定（フォームの初期値）・プランの選択肢。
// プレビュー（loadPartnerRates）・料金の元（暦の未設定日）・最終料金の計算状態は previewInfo（Promise）で後から流す。
export const load: PageServerLoad = async (event) => {
	// 認可（staffPartnerScope）と取引先の読み込み（staffPartnerView）は +layout.server.ts でも同じものが走る（二重）。
	// parent() で受け渡すとタブの切替のたびに layout の結果を待つことになるため、タブ切替の速さを優先してそれぞれで行う（2026-10-10）
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

	const today = todayJst();
	const previewParam = event.url.searchParams.get('preview') ?? '';
	const previewFrom = /^\d{4}-\d{2}-\d{2}$/.test(previewParam) && previewParam >= today ? previewParam : today;
	const previewTo = addDaysIso(previewFrom, PREVIEW_DAYS - 1);

	// プレビュー: 保存済みの最終料金（取引先に見える価格）と特別レート前の料金（2026-10-09 §7）。取引先ページと同じ読み出し
	// （保存済みが無ければ従来の計算）。公開停止中でも見られるように、取引先の公開状態は見ない。施設で販売していなければ作らない
	const previewLoad = (
		row
			? loadPartnerRates(scope.db, { ...partner, show_inventory: true }, { from: previewFrom, to: previewTo }, { includeBase: true })
			: Promise.reject(new Error('この施設では販売していません。'))
	)
		.then((r) => ({ ...r, error: null as string | null }))
		.catch((e) => ({
			days: [] as Awaited<ReturnType<typeof loadPartnerRates>>['days'],
			rooms: [] as { roomCode: string; name: string }[],
			planOptions: [] as PlanOption[],
			priceSource: null as PartnerPriceSource | null,
			priceMode: null as PartnerPriceMode | null,
			computedAt: null as string | null,
			error: e instanceof Error ? e.message : String(e)
		}));
	// 料金の元（取引先ランク暦 / TL のランク）と暦の未設定日（2026-10-09・docs/partner-rank-rates.md §5.4）・
	// 保存済みの最終料金の計算状態（§7）。読めなければ出さない
	const rankLoad = row ? loadPartnerRankStatus(scope.db, partner, today).catch(() => null) : Promise.resolve(null);
	const stateLoad = row ? loadPriceState(scope.db, partner.id, partner.facility_id).catch(() => null) : Promise.resolve(null);

	// 与信（受付枠）の今後 12 か月の月別の判定: 枠・予約済みは施設ごとに数えるので、タブの施設で合成した取引先で求める（後から流す）。
	// 設定（増加率・最低枠・楽観ロック用の更新時刻）は +layout.server.ts（pmsLink.credit）。紐づけが無ければ判定しない
	const creditMonths = (
		partner.pms_guest_id
			? partnerCreditCheck(scope.db, partner, nextMonths(today.slice(0, 7), CREDIT_TABLE_MONTHS)).then((check) => ({
					months: check?.enabled ? check.months : [],
					error: null as string | null
				}))
			: Promise.resolve({ months: [], error: null as string | null })
	)
		.catch((e) => ({ months: [] as NonNullable<Awaited<ReturnType<typeof partnerCreditCheck>>>['months'], error: e instanceof Error ? e.message : String(e) }))
		.then((r) => ({ ...r, tabId: tabFacility.bookFacilityId }));

	// 施設タブ・施設のプラン一覧（プラン名・特典の選択肢。フォームに要るので待つ）
	const [facilityTabs, facilityPlans] = await Promise.all([loadFacilityTabs(event, scope, view), loadFacilityPlanOptions(event, partner.facility_id)]);

	// プランの選択肢（プラン名・特典・特別レートの要約）。施設のプラン一覧（booking.rate_plans）を正とし、保存済みルールにしか無いコードも残す。
	// 施設のプラン一覧が読めなかったときだけ、プレビューに出たプランで補うためにプレビューを待つ。
	// プレビューにだけ出たプラン・部屋の名前は previewInfo（extraPlans・rooms）で後から足す（同じコードが部屋タイプ間で共通なので、コード単位でまとめる）
	const planMap = new Map((facilityPlans ?? (await previewLoad).planOptions).map((p) => [p.code, p]));
	const ruleRooms = new Map<string, { code: string; name: string }>();
	for (const rule of partner.pricing.rules) {
		for (const code of rule.planGroupCodes) {
			if (code !== ADVANCE_PLAN_CODE && !planMap.has(code)) planMap.set(code, { code, label: code, mealType: null });
		}
		for (const code of rule.roomCodes) if (!ruleRooms.has(code)) ruleRooms.set(code, { code, name: code });
	}
	const planOptions = [...planMap.values()].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));

	// 後から流す（失敗しない: 各部品の失敗は上で値にしている）
	const previewInfo = Promise.all([previewLoad, rankLoad, stateLoad]).then(([preview, rankStatus, priceState]) => ({
		// どのタブ・期間の読み込みか（タブ・開始日を切り替えた直後に、前の結果を出さないため）
		tabId: tabFacility.bookFacilityId,
		from: previewFrom,
		preview: { from: previewFrom, to: previewTo, days: preview.days, error: preview.error, priceMode: preview.priceMode, computedAt: preview.computedAt },
		// 保存済みの最終料金の計算状態（rms_partner_price_state）。行が無い・読めなければ null
		priceState,
		// 料金の元: 暦の設定（rankStatus）を優先し、読めなければプレビューの RPC が返した priceSource
		priceSource: {
			source: rankStatus ? (rankStatus.enabled ? 'partner_rank' : 'standard') : preview.priceSource,
			publicDays: rankStatus?.publicDays ?? null,
			missingDays: rankStatus?.missingDays ?? null
		},
		// プレビューに出た部屋の名前（特別レートの要約）と、プランの選択肢に無かったプラン
		rooms: preview.rooms.map((r) => ({ code: r.roomCode, name: r.name })),
		extraPlans: preview.planOptions.filter((p) => !planMap.has(p.code))
	}));

	const origin = event.url.origin;
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
					own: Object.fromEntries(
						[...PARTNER_FACILITY_SETTING_KEYS, ...PARTNER_FACILITY_MEMBER_KEYS].map((k) => [k, partner.booking_settings[k]])
					) as unknown as PartnerFacilityOwnSettings,
					// 特別会員: キャンセル方式（favorable / page / rank）と専用ページの規定（rate は 0〜1）・最大室数（1〜4）
					cancelPolicy: { mode: partner.booking_settings.cancelPolicyMode, rules: partner.booking_settings.cancelRules },
					maxRooms: isMemberPage(partner.kind) ? memberMaxRooms(partner.booking_settings) : partner.booking_settings.maxRooms,
					// N6 の上書き（キーがあるものだけ）
					overrides: readPartnerFacilityOverrides(row.facility_settings),
					bookingOpen: isPartnerBookingOpen(partner),
					updatedAt: row.updated_at
				}
			: null,
		// 「確認ページを開く」: タブの施設で開く（取引先ページは ?f=<slug> のオンの施設を選ぶ）
		previewUrl: `/admin/partners/${partner.id}/preview?f=${encodeURIComponent(partner.facility_slug)}`,
		canEdit: scope.canEdit,
		// 団体予約（docs/partner-group-booking.md §8.3・2026-10-10）: 旅行会社（kind='agent'）のときだけ、この取引先の照会の直近 20 件。
		// オン/オフと上限・選択肢は共通の予約設定（commonSettings.group*）に入っていて、?/saveCommon の booking（JSON）でそのまま保存される。
		// 画面の表示を待たせないよう Promise のまま流す（読めなければ []）
		groupInquiries:
			partner.kind === 'agent' ? listRecentGroupInquiriesOfPartner(scope.db, partner.id, 20).catch(() => []) : Promise.resolve([]),
		kindLabels: PARTNER_KIND_LABELS,
		// 特別会員の専用ページか（法人向けの欄を隠し、対象の会員・キャンセル規定を出す）
		isMemberPage: isMemberPage(partner.kind),
		// 対象の会員（self）と家族として使える会員（family・読み取り）。取引先は []。後から流す（読めなければ []）
		members: isMemberPage(partner.kind) ? listPartnerMembers(scope.db, partner.id).catch(() => []) : Promise.resolve([]),
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
		documentAccept: PARTNER_DOCUMENT_ACCEPT,
		apiEndpoint: `${origin}/api/partner/v1/rates`,
		// API の facility（オンの施設の slug・2つ以上なら必須・複数施設化 S5b・2026-10-09）
		apiFacilities: view.bundle.facilities.filter((f) => !f.synthetic && f.enabled).map((f) => f.slug),
		// 特別レートの部屋の名前（保存済みルールのコード。プレビューに出た名前は previewInfo.rooms で後から）
		rooms: [...ruleRooms.values()],
		planOptions,
		// 取引先の画面に同じ画面で払う決済を出せるか（シークレットキー＋公開可能キー）。出せない理由は下の2つ
		onlinePaymentReady: inlinePaymentReady(),
		stripeSecretReady: onlinePaymentReady(),
		stripePublishableIssue: onlinePaymentReady() && publishableKeyProblem() ? describePublishableKeyIssue(publishableKeyProblem()!) : null,
		stripeTestMode: isStripeTestMode(),
		stripeKeyKind: stripeKeyKind(),
		stripeKeyHint: stripeKeyKind() === 'invalid' ? stripeKeyHint() : null,
		// RMS の取引先料金（特別レートの編集先）
		rmsUrl: rmsPartnerRatesUrl(partner.id, partner.facility_slug),
		// プレビューの期間（開始日の入力欄。中身は previewInfo で後から）
		previewRange: { from: previewFrom, to: previewTo },
		// プレビュー・料金の元・計算の状態（後から流す）
		previewInfo,
		// 与信の月別の判定（タブの施設・後から流す）
		creditMonths
	};
};

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
			// 種別: 特別会員のページは特別会員のまま（フォームの選択肢に無い）。取引先を特別会員には変えない（会員詳細から作る）
			if (isMemberPage(partner.kind)) input.kind = 'member';
			// デポジットの設定は専用のアクション（setCreditDeposit）で保存する。画面に残った古い値で上書きしないよう、今の DB の値を残す
			const current = normalizePartnerBookingSettings(partner.common_settings);
			input.booking_settings = {
				...input.booking_settings,
				creditDeposit: current.creditDeposit,
				creditDepositRemainder: current.creditDepositRemainder
			};
			// 予約を受け付けている施設があるときは、支払方法が要る
			const accepting = view.bundle.facilities.filter((f) => !f.synthetic && f.enabled && f.booking_enabled);
			if (!isMemberPage(partner.kind) && accepting.length && !input.booking_settings.paymentOptions.length) {
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
			const member = isMemberPage(view.partner.kind);
			if (!member && input.patch.enabled && input.patch.booking_enabled && !normalizePartnerBookingSettings(view.partner.common_settings).paymentOptions.length) {
				throw new PartnerStoreError('予約を受け付けるときは、共通の「支払方法」を1つ以上選んで保存してください。');
			}
			// 特別会員: 最大室数は 1〜4（公式と同じ・DB の上限が 4）。取引先はキャンセル方式・規定を保存しない
			if (member && input.overrides.maxRooms !== undefined) input.overrides.maxRooms = memberMaxRooms({ maxRooms: input.overrides.maxRooms });
			if (!member) for (const k of PARTNER_FACILITY_MEMBER_KEYS) delete (input.own as Record<string, unknown>)[k];
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

	// ---- 特別会員の専用ページ: 対象の会員（admin のみ・取引先の共通の操作と同じ権限） ----
	// 会員を探す（会員番号・メールアドレス・電話番号）
	searchMembers: async (event) => {
		try {
			const { partner } = await commonScope(event);
			if (!isMemberPage(partner.kind)) return fail(400, { memberError: '特別会員のページではありません。' });
			const q = String((await event.request.formData()).get('q') ?? '').trim();
			if (q.length < 3) return fail(400, { memberQuery: q, memberError: '会員番号・メールアドレス・電話番号を入れてください。' });
			try {
				const found = (await adminFindMembers(bookAdmin(event), q)) ?? [];
				return { memberQuery: q, candidates: found };
			} catch (e) {
				return fail(400, { memberQuery: q, memberError: linkMemberErrorText(e) });
			}
		} catch (e) {
			return actionFailure(e);
		}
	},
	// 対象の会員に足す（member_user_id）
	addMember: async (event) => {
		try {
			const { db, partner, userId } = await commonScope(event);
			const memberUserId = String((await event.request.formData()).get('member_user_id') ?? '').trim();
			await addPartnerMember(db, partner, memberUserId, userId);
			return { memberAdded: memberUserId };
		} catch (e) {
			if (e instanceof PartnerStoreError) return fail(e.status, { memberError: e.message });
			return actionFailure(e);
		}
	},
	// 対象の会員から外す（家族として使えている会員は PMS の家族で外す）
	removeMember: async (event) => {
		try {
			const { db, partner } = await commonScope(event);
			if (!isMemberPage(partner.kind)) throw new PartnerStoreError('特別会員のページではありません。');
			const memberUserId = String((await event.request.formData()).get('member_user_id') ?? '').trim();
			// このページ経由で生きている予約が残っている会員は外せない（「このページ経由のご予約が残っているため外せません（N件）」・DB でも止まる）
			await removePartnerMember(db, partner.id, memberUserId);
			return { memberRemoved: memberUserId };
		} catch (e) {
			if (e instanceof PartnerStoreError) return fail(e.status, { memberError: e.message });
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
			const { db, partner, userId } = await editScope(event);
			const fd = await event.request.formData();
			const op = String(fd.get('op') ?? '');
			const accountId = String(fd.get('account_id') ?? '');
			if (op === 'delete') {
				await deletePartnerAccount(db, partner, accountId);
			} else if (op === 'logout') {
				// すべての端末からログアウト（停止はしない・§6.7）
				const { count } = await revokeAllSessionsByStaff(db, partner.id, accountId, userId);
				return { accountUpdated: true, accountMessage: `${count}台の端末をログアウトさせました。` };
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

	// 本人確認の方針（rms_partners.mfa_policy・docs/auth-hardening.md §6.3・S6）。共通の設定なので commonScope（admin・全施設）。
	// 変更は access_logs（channel='admin'・mfa_policy_change）に残る。passkey_only にすると、パスキーの無いユーザーはログインできなくなる
	setMfaPolicy: async (event) => {
		try {
			const s = await commonScope(event);
			const fd = await event.request.formData();
			const value = String(fd.get('mfa_policy') ?? '');
			if (!PARTNER_MFA_POLICIES.includes(value as PartnerMfaPolicy)) throw new PartnerStoreError('本人確認の方針を選んでください。');
			const r = await setPartnerMfaPolicy(s.db, {
				partnerId: s.partner.id,
				policy: value as PartnerMfaPolicy,
				by: `admin:${s.userId ?? 'unknown'}`,
				channel: 'admin',
				ip: requestMeta(event).ip
			});
			return {
				mfaPolicySaved: r.changed
					? `本人確認の方針を「${PARTNER_MFA_POLICY_LABELS[value as PartnerMfaPolicy]}」にしました（変更前: ${PARTNER_MFA_POLICY_LABELS[normalizeMfaPolicy(r.from)]}）。`
					: '変更はありませんでした。'
			};
		} catch (e) {
			return actionFailure(e);
		}
	},

	// アカウントの第2要素をリセット（§6.8・M14）: パスキー全削除・メールの確認済みを外す・全端末ログアウト・mfa_reset_at/by・監査ログ。
	// マスタのリセットは宿（admin）だけ＝ここ。本人確認は「登録済みの電話番号へ宿から折り返し、担当者名と直近の予約を口頭で確認」（§13）。
	// 「設定リンクをメールで送る」に印があれば、パスワード設定リンクも再発行して送る（passkey_only の取引先は、そのリンクから入って最初のパスキーを登録する）
	resetAccountMfa: async (event) => {
		try {
			const s = await editScope(event);
			const fd = await event.request.formData();
			const r = await resetAccountMfa(s.db, {
				partnerId: s.partner.id,
				accountId: String(fd.get('account_id') ?? ''),
				by: { kind: 'admin', staffId: s.userId ?? null },
				ip: requestMeta(event).ip
			});
			let issued: Awaited<ReturnType<typeof issueSetupLink>> | null = null;
			if (fd.get('reissue') === 'on' && r.account.is_active) {
				const { account, setupToken } = await reissueSetupToken(s.db, s.partner, r.account.id);
				issued = await issueSetupLink(event, s, account, setupToken, account.email && fd.get('send_email') === 'on' ? account.email : null);
			}
			return {
				accountUpdated: true,
				accountMessage: `${r.account.login_id} の第2要素をリセットしました（パスキー ${r.passkeys}件を削除・${r.sessions}台の端末をログアウト）。`,
				...(issued ? { issued } : {})
			};
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
