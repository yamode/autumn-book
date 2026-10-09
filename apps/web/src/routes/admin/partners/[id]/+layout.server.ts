// 管理画面: 取引先の詳細のうち、施設タブに関係しない読み込み（2026-10-10・施設タブの切替を軽くする）。
// ログインID・API キー・覚書・ファイル・PMS の顧客（紐づけ・与信）・予約一覧・アクセスログ・請求書・保存カード。
//
// 施設タブ（?fac=）・プレビューの開始日（?preview=）は +page.server.ts が読む。この load は ?inv=（請求書の対象月）しか読まないので、
// SvelteKit は施設タブを切り替えてもこの load をやり直さない（url.searchParams は読んだキーだけが再実行の条件になる。
// event.url の他の項目〔origin・pathname 等〕を読むと URL が変わるたびにやり直すので、ここでは読まない）。
// 保存などの操作の後は use:enhance の update（invalidateAll）でこちらも読み直す。
// 取引先は ab_fac の施設（既定の施設）で合成する。ここで使う設定（請求条件・支払方法・与信・デポジット）は共通のキーなので、
// 施設タブの施設で合成したときと同じ値になる。
//
// 重いもの（予約一覧〔キャンセル料の見込み・添付の件数〕・アクセスログ・請求書〔一覧・プレビュー〕・保存カード）は
// Promise で返してストリーミングし、画面（lib/streamed.svelte.ts）は届くまで枠を出す。Promise は失敗させない（error で表す）。
// 覚書の本文（編集欄の初期値）・ログインID・API キー・PMS の紐づけ（フォームが使う）は待つ。
import { redirect, type RequestEvent } from '@sveltejs/kit';
import { partnerSavedCardSummary } from '$lib/server/payments/saved-cards';
import { describeBooker, depositRemainderModeOf, normalizeBooker } from '$lib/partner-booking';
import { countBookingAttachments, partnerBookingAttachmentsEnabled } from '$lib/server/partners/booking-attachments';
import {
	bookingNameLineOf,
	cancelFeeBasisLabel,
	cancelFeeSettlementLabel,
	cancelKeptNote,
	depositSummary,
	listPartnerBookings,
	onlinePaymentReady,
	previewPartnerCancels
} from '$lib/server/partners/booking';
import {
	bookFacilityMeta,
	getAgencyCreditState,
	getPmsPartnerGuest,
	listPartnerAccessLogs,
	listPartnerAccounts,
	listPartnerApiKeys,
	PartnerStoreError,
	todayJst,
	type StaffPartnerView
} from '$lib/server/partners/store';
import { staffPartnerScope, staffPartnerView, StaffScopeError } from '$lib/server/partners/staff';
import { formatBytes, getPartnerMemorandum, listPartnerDocuments, MAX_MEMORANDUM_LENGTH } from '$lib/server/partners/memorandum';
import { listPartnerInvoices, normalizePeriod, previewPartnerInvoice } from '$lib/server/partners/invoices';
import { invoicePdfReady } from '$lib/server/partners/invoice-pdf';
import { isPartnerBilledBooking, periodOf } from '$lib/partner-invoice';
import { pmsGuestCreditUrl, pmsGuestUrl } from '$lib/pms-partner-guest';
import { bookActorUserId, creditOverLine, creditUpdatedSource, isCreditOver } from '$lib/partner-credit';
import type { LayoutServerLoad } from './$types';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const load: LayoutServerLoad = async (event) => {
	// 認可（staffPartnerScope）と取引先の読み込み（staffPartnerView）は +page.server.ts でも同じものが走る（二重）。
	// parent() で受け渡すと施設タブの切替のたびにこちらも待つ形になるため、タブ切替の速さを優先してそれぞれで行う（2026-10-10）
	let scope;
	try {
		scope = await staffPartnerScope(event, 'view');
	} catch (e) {
		// 使えない環境・権限なしは一覧で理由を出す
		if (e instanceof StaffScopeError) redirect(303, '/admin/partners');
		throw e;
	}
	let view: StaffPartnerView;
	try {
		view = await staffPartnerView(event, scope, event.params.id);
	} catch (e) {
		// 見られない取引先（アクセスできる施設に設定が無い・別テナント）・存在しない ID は一覧へ
		if (e instanceof PartnerStoreError) redirect(303, '/admin/partners');
		throw e;
	}
	const partner = view.partner;
	const db = scope.db;
	const today = todayJst();

	// 請求書: 対象月（?inv=YYYY-MM・既定は当月）
	const currentPeriod = periodOf(today);
	const invPeriodRaw = normalizePeriod(event.url.searchParams.get('inv'));
	const invoicePeriod = invPeriodRaw && invPeriodRaw <= currentPeriod ? invPeriodRaw : currentPeriod;

	// ---- 待つもの（フォームの初期値・ラベルに使う） ----
	const [accounts, apiKeys, memo, documents, pmsGuest, facilityMetas] = await Promise.all([
		listPartnerAccounts(db, partner.id),
		listPartnerApiKeys(db, partner.id),
		// 覚書（本文・ファイル）。読めなくても他の欄は出す
		getPartnerMemorandum(db, partner.id)
			.then((m) => ({ ...m, error: null as string | null }))
			.catch((e) => ({ text: '', updatedAt: null as string | null, error: errorText(e) })),
		listPartnerDocuments(db, partner.id)
			.then((rows) => ({ rows, error: null as string | null }))
			.catch((e) => ({ rows: [], error: errorText(e) })),
		// PMS の顧客マスタの紐づけ先（読めなくても他の欄は出す）
		getPmsPartnerGuest(db, partner.tenant_id, partner.pms_guest_id)
			.then((guest) => ({ guest, error: null as string | null }))
			.catch((e) => ({ guest: null, error: errorText(e) })),
		// 予約の施設名（予約一覧の施設の列）
		bookFacilityMeta(db).catch(() => [] as { id: string; slug: string; name: string }[])
	]);
	// 与信（受付枠・Phase 3a）: 紐づけ先が旅行会社のときだけ読む（法人・未紐づけでは出さない）
	const credit = pmsGuest.guest?.guestType === 'group' ? await loadCreditSection(event, scope, partner) : null;

	const accountLabel = new Map(accounts.map((a) => [a.id, a.login_id]));
	const keyLabel = new Map(apiKeys.map((k) => [k.id, k.label || k.key_prefix]));
	const facilityNames = new Map(facilityMetas.map((m) => [m.id, m.name]));
	const facilityNameOf = (id: string | null | undefined) => (id ? (facilityNames.get(id) ?? '') : '');

	// ---- 後から流すもの ----
	// 予約一覧（キャンセル料の見込み〔取消フォーム〕・添付の件数は一覧を読んでから並べて読む）
	const bookingsLoad = (async () => {
		const bookings = await listPartnerBookings(db, { partnerId: partner.id, limit: 200 });
		const [cancelPreviews, attachmentCounts] = await Promise.all([
			previewPartnerCancels(db, partner.facility_id, bookings).catch(() => ({}) as Awaited<ReturnType<typeof previewPartnerCancels>>),
			// 予約ごとの添付ファイルの件数（📎 N・2026-10-07）。操作は予約管理の詳細に集める。機能が off・読めなければ空
			partnerBookingAttachmentsEnabled()
				? countBookingAttachments(db, partner.id, bookings.map((b) => b.id)).catch(() => new Map<string, number>())
				: Promise.resolve(new Map<string, number>())
		]);
		return {
			error: null as string | null,
			rows: bookings.map((b) => ({
				// キャンセル料の見込み（取消フォーム）と、取消済みのキャンセル料
				cancelPreview: cancelPreviews[b.id] ?? null,
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
			}))
		};
	})();
	const bookingList = bookingsLoad.catch((e): Awaited<typeof bookingsLoad> => ({ error: `予約一覧を読み込めませんでした（${errorText(e)}）`, rows: [] }));

	// アクセスログ（直近50件）
	const logsLoad = listPartnerAccessLogs(db, partner.id, 50).then((logs) => ({
		error: null as string | null,
		rows: logs.map((l) => ({
			id: l.id,
			at: l.created_at,
			channel: l.channel,
			action: l.action,
			who: l.account_id ? (accountLabel.get(l.account_id) ?? '(削除済み)') : l.api_key_id ? (keyLabel.get(l.api_key_id) ?? '(削除済み)') : null,
			detail: l.detail,
			ip: l.ip
		}))
	}));
	const accessLogs = logsLoad.catch((e): Awaited<typeof logsLoad> => ({ error: `アクセスログを読み込めませんでした（${errorText(e)}）`, rows: [] }));

	// 請求書（発行済み一覧と対象月のプレビュー。読めなくても他の欄は出す）
	const invoiceLoad = Promise.all([
		listPartnerInvoices(db, partner.id)
			.then((rows) => ({ rows, error: null as string | null }))
			.catch((e) => ({ rows: [], error: errorText(e) })),
		previewPartnerInvoice(db, partner, invoicePeriod)
			.then((r) => ({ ...r, error: null as string | null }))
			.catch((e) => ({ document: null, bookingCount: 0, settings: null, chargeFailed: [] as string[], error: errorText(e) }))
	]).then(([invoices, invoicePreview]) => ({
		// どの月の読み込みか（対象月を切り替えた直後に、前の月の結果を出さないため）
		period: invoicePeriod,
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
	}));
	const invoiceData = invoiceLoad.catch(
		(e): Awaited<typeof invoiceLoad> => ({
			period: invoicePeriod,
			error: `請求書を読み込めませんでした（${errorText(e)}）`,
			rows: [],
			preview: null,
			previewError: null,
			chargeFailed: [],
			bankAccountMissing: false,
			autoIssue: true
		})
	);

	// 取引先のお支払いカード（保存カード・2026-10-07）の枚数と最終登録（読むだけ・問い合わせ対応用・N10）。読めなければ出さない
	const savedCards = onlinePaymentReady() ? partnerSavedCardSummary(db, partner).catch(() => null) : Promise.resolve(null);

	return {
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
		// 請求書の対象月（すぐ出す）と、一覧・プレビュー（後から流す）
		invoicePeriod: { period: invoicePeriod, currentPeriod, pdfReady: invoicePdfReady() },
		invoiceData,
		bookingList,
		accessLogs,
		savedCards
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

// 与信（受付枠）のセクション: 設定（PMS の metadata.pms の4キー・楽観ロック用の updated_at）・最終更新。
// 今後 12 か月の月別の判定（rms_partner_credit_check）は施設ごとに数えるので、施設タブの施設で +page.server.ts が求める（creditMonths）。
// 読めなくても他の欄は出す（error に理由）。
async function loadCreditSection(
	event: RequestEvent,
	scope: Awaited<ReturnType<typeof staffPartnerScope>>,
	partner: StaffPartnerView['partner']
) {
	const guestId = partner.pms_guest_id as string;
	try {
		const state = await getAgencyCreditState(scope.db, partner.tenant_id, guestId);
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
			pmsCreditUrl: pmsGuestCreditUrl(guestId),
			error: null as string | null
		};
	} catch (e) {
		return {
			state: null,
			updatedAt: null,
			updatedSource: '',
			pmsCreditUrl: pmsGuestCreditUrl(guestId),
			error: errorText(e)
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
