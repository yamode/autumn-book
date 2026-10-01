// 管理画面: 取引先の詳細（限定URL・覚書・公開設定・特別レート・予約受付・プレビュー・予約・ログインID・API キー・アクセスログ）。
// autumn-rms の /partners/[id]（v0.103.0）から移設（2026-09-26）。
// 閲覧は admin / staff、操作（保存・再発行・発行・取消と返金・再請求・削除）は admin のみ（staff.ts の canEditPartners）。
import { redirect, type RequestEvent } from '@sveltejs/kit';
import { ADVANCE_PLAN_CODE, DEFAULT_PARTNER_PRICING, type PartnerPricing } from '$lib/partner-pricing';
import { describeBooker, normalizeBooker } from '$lib/partner-booking';
import { friendlyId } from '$lib/server/partners/crypto';
import { loadPartnerRates } from '$lib/server/partners/rates';
import { describePublishableKeyIssue } from '$lib/server/payments/keys';
import { publishableKeyProblem } from '$lib/server/stripe';
import {
	cancelPartnerBooking,
	isPartnerBookingOpen,
	isStripeTestMode,
	listPartnerBookings,
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

	const [accounts, apiKeys, logs, bookings, preview, memo, documents] = await Promise.all([
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
			.catch((e) => ({ rows: [], error: e instanceof Error ? e.message : String(e) }))
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
			id: b.id,
			code: b.booking_code,
			status: b.status,
			checkedIn: !!b.checkedIn,
			checkIn: b.check_in_date,
			nights: b.nights,
			roomName: b.room_name ?? b.room_code ?? '',
			roomCount: b.room_count,
			adultTotal: b.adult_total,
			planName: b.plan_name ?? '',
			guestName: b.guest_name,
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
			cardLabel: b.card_label,
			chargeError: b.charge_error,
			refundError: b.refund_error,
			...bookingExtras(b.detail)
		})),
		preview: { from: previewFrom, to: previewTo, days: preview.days, error: preview.error }
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
				refund: fd.get('refund') !== null
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
